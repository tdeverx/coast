import { conflictPreference } from './preference';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import {
  providerConnections,
  syncValues,
  trackingState,
  ratings,
  trackingEvents,
  outboxActions,
  type JsonObject,
} from '$lib/server/db/schema';
import { trackInTransaction } from '$lib/core/tracking/service';
import { rateInTransaction } from '$lib/core/ratings/service';
import { enqueueSyncValueInTransaction } from './changes';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ValueCategory =
  | 'history'
  | 'progress'
  | 'watchlist'
  | 'collection'
  | 'favourite'
  | 'ratings';
export const valueCategories: ValueCategory[] = [
  'history',
  'progress',
  'watchlist',
  'collection',
  'favourite',
  'ratings',
];
export function sameValue(a: JsonObject | null | undefined, b: JsonObject) {
  return (
    !!a &&
    Object.keys({ ...a, ...b }).every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
  );
}
export async function localSyncValue(
  tx: Transaction,
  userId: string,
  mediaId: string,
  category: ValueCategory
): Promise<JsonObject> {
  if (category === 'ratings') {
    const [rating] = await tx
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.mediaId, mediaId)));
    return { value: rating?.value ?? null };
  }
  const [state] = await tx
    .select()
    .from(trackingState)
    .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, mediaId)));
  if (category === 'progress')
    return {
      positionSeconds: Math.round((state?.positionSeconds ?? 0) * 1000) / 1000,
      durationSeconds: Math.round(state?.durationSeconds ?? 0),
    };
  const field =
    category === 'history' ? 'watched' : category === 'collection' ? 'collected' : category;
  return { value: state?.[field] ?? false };
}
export async function applySyncValue(
  tx: Transaction,
  userId: string,
  mediaId: string,
  category: ValueCategory,
  value: JsonObject,
  source: string,
  occurredAt?: string
) {
  if (category === 'ratings') {
    await rateInTransaction(tx, userId, { mediaId, value: value.value as number | null });
    await tx
      .update(ratings)
      .set({ source })
      .where(and(eq(ratings.userId, userId), eq(ratings.mediaId, mediaId)));
  } else
    await trackInTransaction(tx, userId, {
      mediaId,
      source,
      acknowledged: true,
      occurredAt,
      action:
        category === 'history'
          ? value.value
            ? 'watch'
            : 'unwatch'
          : category === 'collection'
            ? 'collect'
            : category,
      ...(category === 'progress'
        ? {
            positionSeconds: Number(value.positionSeconds),
            durationSeconds: Number(value.durationSeconds),
          }
        : { value: Boolean(value.value) }),
    });
}
/** Compare three values. A conflict persists until an explicit winner is chosen. */
export function decideSync(
  local: JsonObject,
  remote: JsonObject,
  previous?: { remote: JsonObject; agreed: JsonObject | null; conflict: boolean }
) {
  if (previous?.conflict) return 'conflict';
  if (sameValue(local, remote)) return 'agree';
  if (previous) {
    if (sameValue(previous.remote, remote)) return 'local';
    return sameValue(previous.agreed, local) ? 'remote' : 'conflict';
  }
  // An initial import can fill empty state; existing divergent user choices require review.
  const empty = Object.entries(local).every(([key, value]) => key === 'durationSeconds' || !value);
  return empty ? 'remote' : 'conflict';
}
export async function reconcileProviderValue(
  userId: string,
  connectionId: string,
  mediaId: string,
  category: ValueCategory,
  remote: JsonObject,
  options: {
    source?: string;
    occurredAt?: string;
    apply?: (tx: Transaction) => Promise<unknown>;
  } = {}
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [connection] = await tx
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    if (!connection) throw new Error('Connection does not belong to this account.');
    const [previous] = await tx
      .select()
      .from(syncValues)
      .where(
        and(
          eq(syncValues.connectionId, connectionId),
          eq(syncValues.mediaId, mediaId),
          eq(syncValues.category, category)
        )
      );
    const local = await localSyncValue(tx, userId, mediaId, category);
    let decision = decideSync(local, remote, previous);
    if (!previous && decision === 'remote') {
      const actions =
        category === 'history'
          ? ['watch', 'unwatch']
          : category === 'collection'
            ? ['collect']
            : [category];
      const [edited] = await tx
        .select({ id: trackingEvents.id })
        .from(trackingEvents)
        .where(
          and(
            eq(trackingEvents.userId, userId),
            eq(trackingEvents.mediaId, mediaId),
            sql`${trackingEvents.action} in (${sql.join(
              actions.map((action) => sql`${action}`),
              sql`,`
            )})`,
            eq(trackingEvents.applied, true)
          )
        )
        .limit(1);
      const [queued] = await tx
        .select({ id: outboxActions.id })
        .from(outboxActions)
        .where(
          and(
            eq(outboxActions.userId, userId),
            sql`${outboxActions.payload}->>'mediaId' = ${mediaId}`,
            sql`${outboxActions.payload}->>'category' = ${category}`,
            sql`${outboxActions.state} in ('pending', 'running')`
          )
        )
        .limit(1);
      if (edited || queued) decision = 'conflict';
    }
    const preference = await conflictPreference(tx, userId, connectionId);
    const ownedConnections = tx
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(eq(providerConnections.userId, userId));
    const [pending] = await tx
      .select({ id: syncValues.id })
      .from(syncValues)
      .where(
        and(
          inArray(syncValues.connectionId, ownedConnections),
          eq(syncValues.mediaId, mediaId),
          eq(syncValues.category, category),
          eq(syncValues.conflict, true)
        )
      )
      .limit(1);
    // A preferred account can also settle conflicts first observed on another destination.
    const automatic = (decision === 'conflict' || !!pending) && preference !== 'manual';
    if (automatic) {
      decision = preference;
      const winning = preference === 'remote' ? remote : local;
      if (preference === 'remote')
        await applySyncValue(
          tx,
          userId,
          mediaId,
          category,
          winning,
          options.source ?? 'provider-sync',
          options.occurredAt
        );
      await tx
        .update(syncValues)
        .set({ conflict: false, agreed: winning, updatedAt: new Date() })
        .where(
          and(
            inArray(syncValues.connectionId, ownedConnections),
            eq(syncValues.mediaId, mediaId),
            eq(syncValues.category, category)
          )
        );
    }
    if (!automatic && (decision === 'remote' || (decision === 'agree' && options.apply))) {
      let changed = true;
      if (options.apply) {
        const result = (await options.apply(tx)) as
          | { changed?: boolean; duplicate?: boolean; reviewRequired?: boolean }
          | undefined;
        changed = !!result?.changed && !result.duplicate && !result.reviewRequired;
        if (result?.reviewRequired) decision = 'conflict';
        else if (changed) decision = 'remote';
      } else
        await applySyncValue(
          tx,
          userId,
          mediaId,
          category,
          remote,
          options.source ?? 'provider-sync',
          options.occurredAt
        );
      if (changed)
        await enqueueSyncValueInTransaction(tx, userId, mediaId, category, remote, connectionId);
    }
    const agreed =
      automatic || decision === 'remote' || decision === 'agree'
        ? await localSyncValue(tx, userId, mediaId, category)
        : (previous?.agreed ?? null);
    await tx
      .insert(syncValues)
      .values({
        connectionId,
        mediaId,
        category,
        remote,
        agreed,
        conflict: decision === 'conflict',
      })
      .onConflictDoUpdate({
        target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
        set: { remote, agreed, conflict: decision === 'conflict', updatedAt: new Date() },
      });
    if (automatic)
      await enqueueSyncValueInTransaction(
        tx,
        userId,
        mediaId,
        category,
        preference === 'remote' ? remote : local,
        preference === 'remote' ? connectionId : undefined
      );
    return decision;
  });
}

export async function acknowledgeProviderValue(
  userId: string,
  connectionId: string,
  mediaId: string,
  category: ValueCategory,
  remote: JsonObject
) {
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const agreed = remote;
    await tx
      .insert(syncValues)
      .values({ connectionId, mediaId, category, remote, agreed })
      .onConflictDoUpdate({
        target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
        set: { remote, agreed, updatedAt: new Date() },
      });
  });
}
