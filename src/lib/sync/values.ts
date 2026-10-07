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
  works, musicProgress,
  type JsonObject,
} from '$lib/server/db/schema';
import { trackInTransaction } from '$lib/core/tracking/service';
import { rateInTransaction } from '$lib/core/ratings/service';
import { enqueueSyncValueInTransaction } from './changes';
import { assertJobLease } from '$lib/server/queue/execution';

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
  // Resume positions arrive as percentages, ticks or rounded seconds.
  // Runtime is metadata, not a competing personal edit.
  if (a && typeof a.positionSeconds === 'number' && typeof b.positionSeconds === 'number')
    return a.positionSeconds === b.positionSeconds ||
      (a.positionSeconds > 0 && b.positionSeconds > 0 && Math.abs(a.positionSeconds - b.positionSeconds) <= 1);
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
  const [work]=await tx.select().from(works).where(eq(works.id,mediaId));
  if(work?.category==='music'&&(category==='history'||category==='progress')){
    const [state]=await tx.select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,mediaId)));
    return category==='history'?{value:(state?.playCount??0)>0,playCount:state?.playCount??0}:{positionSeconds:Math.round((state?.positionSeconds??0)*1000)/1000,durationSeconds:Math.round(state?.durationSeconds??0)};
  }
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
      // Providers clear resume markers after completion. Preserve concrete Coast
      // history/progress while comparing the shared resume state.
      positionSeconds: state?.watched && state.durationSeconds &&
        state.positionSeconds >= state.durationSeconds - Math.min(1,state.durationSeconds * 0.01)
        ? 0 : Math.round((state?.positionSeconds ?? 0) * 1000) / 1000,
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
  const [work]=await tx.select().from(works).where(eq(works.id,mediaId));
  if(work?.category==='music'&&(category==='history'||category==='progress')){
    const fields=category==='history'?{playCount:value.value?Math.max(1,Number(value.playCount??1)):0}:{positionSeconds:Number(value.positionSeconds),durationSeconds:Number(value.durationSeconds)};
    await tx.insert(musicProgress).values({userId,trackId:mediaId,...fields}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{...fields,updatedAt:new Date()}});return;
  }
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
/** Compare personal edits. Convergence needs no winner or remote write. */
export function decideSync(
  local: JsonObject,
  remote: JsonObject,
  previous?: { remote: JsonObject; agreed: JsonObject | null; conflict: boolean }
): 'agree'|'local'|'remote'|'conflict' {
  if (sameValue(local, remote)) return 'agree';
  // An uninitialized destination has no competing user value. This also
  // reclassifies initial-empty conflicts produced by earlier comparisons.
  if (previous?.agreed === null && emptySyncValue(remote) && !emptySyncValue(local))
    return 'local';
  if (previous?.conflict) return 'conflict';
  if (previous) {
    if (sameValue(previous.remote, remote)) return 'local';
    return sameValue(previous.agreed, local) ? 'remote' : 'conflict';
  }
  // An initial import can fill empty state; existing divergent user choices require review.
  return emptySyncValue(local) ? 'remote' : emptySyncValue(remote) ? 'local' : 'conflict';
}
function emptySyncValue(value: JsonObject) {
  return Object.entries(value).every(([key, value]) => key === 'durationSeconds' || !value);
}
export async function reconcileProviderValue(
  userId: string,
  connectionId: string,
  mediaId: string,
  category: ValueCategory,
  remote: JsonObject,
  options: {
    source?: string;
    accountGeneration?: string;
    importRemote?: boolean;
    occurredAt?: string;
    apply?: (tx: Transaction) => Promise<unknown>;
    onReconciled?: (tx: Transaction, decision: 'agree' | 'local' | 'remote' | 'conflict') => Promise<void>;
  } = {}
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [connection] = await tx
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).for('update');
    if (!connection) throw new Error('Connection does not belong to this account.');
    await assertJobLease(tx,true);
    if(options.accountGeneration && (connection.accountGeneration!==options.accountGeneration || connection.status!=='connected'))
      throw new Error('The connected account changed before reconciliation.');
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
    // An outbound read can expose divergence, but an import opt-out must still
    // prevent it from silently applying that remote state to Coast.
    if(options.importRemote===false && decision==='remote')decision='conflict';
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
            eq(trackingEvents.applied, true),
            sql`${trackingEvents.source} in ('coast','playback','coast-review')`
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
    const selectedPreference = await conflictPreference(tx, userId, connectionId);
    const preference=options.importRemote===false&&selectedPreference==='remote'?'manual':selectedPreference;
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
    await options.onReconciled?.(tx, decision);
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
    const local = await localSyncValue(tx, userId, mediaId, category);
    await tx
      .insert(syncValues)
      .values({ connectionId, mediaId, category, remote, agreed })
      .onConflictDoUpdate({
        target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
        set: { remote, agreed, ...(sameValue(local, remote) ? {conflict:false} : {}), updatedAt: new Date() },
      });
  });
}
