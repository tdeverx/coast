import { context } from '$lib/server/diagnostics';
import { correlationId } from '$lib/diagnostics';
import { supportsProviderField } from '$lib/providers/capabilities';
import { and, eq, inArray, asc, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import {
  providerConnections,
  providerInstances,
  outboxActions,
  externalIds,
  systemSettings,
  notifications,
  availability,
  providerItems,
  syncValues,
  trackingState,
} from '$lib/server/db/schema';
import {
  trackInTransaction,
  bulkTrackInTransaction,
  type TrackingInput,
  bulkTrackingInputSchema,
} from '$lib/core/tracking/service';
import { rateInTransaction, ratingInputSchema } from '$lib/core/ratings/service';
import * as v from 'valibot';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type ExportChange = {
  mediaId: string;
  category: 'history' | 'collection' | 'ratings' | 'watchlist';
  remove?: boolean;
  value?: number;
  occurredAt?: string;
  eventId?: string;
  fromPlayback?: boolean;
  excludeConnectionId?: string;
};
async function traktConnectionsForMedia(tx: Transaction, userId: string, mediaId: string) {
  const [settings] = await tx.select().from(systemSettings).where(eq(systemSettings.key, 'coast'));
  if ((settings?.value as { enableTrakt?: boolean } | undefined)?.enableTrakt === false) return [];
  const [mapping] = await tx
    .select({ id: externalIds.id })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.mediaId, mediaId),
        inArray(externalIds.provider, ['trakt', 'tmdb', 'tvdb', 'imdb'])
      )
    )
    .limit(1);
  if (!mapping) return [];
  return tx
    .select({ connection: providerConnections })
    .from(providerConnections)
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.status, 'connected'),
        eq(providerInstances.provider, 'trakt'),
        eq(providerInstances.enabled, true)
      )
    )
    .orderBy(asc(providerConnections.id));
}

/** Shares the existing transaction so native state and outbound intent cannot diverge. */
export async function enqueueInTransaction(
  tx: Transaction,
  action: {
    userId: string;
    connectionId: string;
    kind: string;
    payload: Record<string, unknown>;
    compactionKey?: string;
  }
) {
  const { userId, connectionId, compactionKey } = action;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${connectionId}`},0))`
  );
  if (compactionKey) {
    const replaced = await tx
      .update(outboxActions)
      .set({
        state: 'cancelled',
        lastError: 'Replaced by a newer pending edit.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxActions.userId, userId),
          eq(outboxActions.connectionId, connectionId),
          eq(outboxActions.state, 'pending'),
          eq(outboxActions.compactionKey, compactionKey)
        )
      )
      .returning({ id: outboxActions.id });
    if (replaced.length)
      await tx.delete(notifications).where(
        and(
          eq(notifications.userId, userId),
          inArray(
            notifications.sourceKey,
            replaced.map((old) => `outbox:${old.id}`)
          )
        )
      );
  }
  await tx.insert(outboxActions).values({ correlationId: correlationId(context.getStore()), ...action, createdAt: sql`clock_timestamp()` });
}

/** Native mutation and its outbound intent commit together, including bulk child events. */
export async function enqueueTraktChangeInTransaction(
  tx: Transaction,
  userId: string,
  change: ExportChange
) {
  if (!supportsProviderField('trakt', 'screen', change.category, 'write')) return;
  let occurredAt = change.occurredAt;
  if (change.category === 'history' && !change.remove && !change.eventId && !occurredAt) {
    const [state] = await tx
      .select({ date: trackingState.lastWatchedAt })
      .from(trackingState)
      .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, change.mediaId)));
    occurredAt = state?.date?.toISOString();
  }
  const connections = await traktConnectionsForMedia(tx, userId, change.mediaId);
  for (const { connection } of connections) {
    const sync = connection.settings.sync as Record<string, boolean> | undefined;
    if (connection.id === change.excludeConnectionId) continue;
    const [conflict] = await tx
      .select({ id: syncValues.id })
      .from(syncValues)
      .where(
        and(
          eq(syncValues.connectionId, connection.id),
          eq(syncValues.mediaId, change.mediaId),
          eq(syncValues.category, change.category),
          eq(syncValues.conflict, true)
        )
      );
    if (conflict) continue;
    if (!sync?.[change.category] || (change.fromPlayback && sync.scrobble)) continue;
    await enqueueInTransaction(tx, {
      userId,
      connectionId: connection.id,
      kind: 'trakt.export',
      payload: { ...change, occurredAt },
      compactionKey:
        change.category === 'history' ? undefined : `trakt:${change.category}:${change.mediaId}`,
    });
  }
}
/** Manual Jellyfin edits use the same durable transaction as native tracking. */
async function enqueueJellyfinChange(
  tx: Transaction,
  userId: string,
  mediaId: string,
  action: string,
  value?: boolean | number,
  excludeConnectionId?: string,
  durationSeconds?: number
) {
  const field =
    action === 'watch' || action === 'unwatch'
      ? 'history'
      : action === 'favourite'
        ? 'favourite'
        : action === 'progress'
          ? 'progress'
          : null;
  if (!field || !supportsProviderField('jellyfin', 'screen', field, 'write')) return;
  const connections = await tx
    .selectDistinct({ id: providerConnections.id })
    .from(availability)
    .innerJoin(providerConnections, eq(providerConnections.id, availability.connectionId))
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.mediaId, mediaId),
        eq(availability.state, 'available'),
        eq(providerConnections.userId, userId),
        eq(providerConnections.status, 'connected'),
        eq(providerInstances.provider, 'jellyfin'),
        eq(providerInstances.enabled, true)
      )
    )
    .orderBy(asc(providerConnections.id));
  for (const connection of connections) {
    if (connection.id === excludeConnectionId) continue;
    const [conflict] = await tx
      .select({ id: syncValues.id })
      .from(syncValues)
      .where(
        and(
          eq(syncValues.connectionId, connection.id),
          eq(syncValues.mediaId, mediaId),
          eq(
            syncValues.category,
            action === 'favourite' ? 'favourite' : action === 'progress' ? 'progress' : 'history'
          ),
          eq(syncValues.conflict, true)
        )
      );
    if (conflict) continue;
    await enqueueInTransaction(tx, {
      userId,
      connectionId: connection.id,
      kind: 'jellyfin.user-state',
      payload: {
        mediaId,
        field:
          action === 'progress' ? 'progress' : action === 'favourite' ? 'favourite' : 'watched',
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        value: action === 'unwatch' ? false : (value ?? true),
      },
      compactionKey: `jellyfin:${action === 'progress' ? 'progress' : action === 'favourite' ? 'favourite' : 'watched'}:${mediaId}`,
    });
  }
}
export async function enqueueSyncValueInTransaction(
  tx: Transaction,
  userId: string,
  mediaId: string,
  category: import('./values').ValueCategory,
  value: Record<string, unknown>,
  excludeConnectionId?: string
) {
  if (category === 'history' || category === 'favourite')
    await enqueueJellyfinChange(
      tx,
      userId,
      mediaId,
      category === 'history' ? (value.value ? 'watch' : 'unwatch') : 'favourite',
      Boolean(value.value),
      excludeConnectionId
    );
  if (category === 'favourite') return;
  if (category === 'progress') {
    const duration = Number(value.durationSeconds);
    if (!duration) return;
    await enqueueJellyfinChange(
      tx,
      userId,
      mediaId,
      'progress',
      Number(value.positionSeconds),
      excludeConnectionId,
      duration
    );
    for (const { connection } of await traktConnectionsForMedia(tx, userId, mediaId)) {
      if (
        connection.id === excludeConnectionId ||
        !(connection.settings.sync as Record<string, boolean>)?.progress
      )
        continue;
      await enqueueInTransaction(tx, {
        userId,
        connectionId: connection.id,
        kind: 'trakt.progress',
        payload: {
          mediaId,
          progress: (Number(value.positionSeconds) / duration) * 100,
          resolved: true,
          durationSeconds: duration,
        },
        compactionKey: `trakt-progress:${mediaId}`,
      });
    }
    return;
  }
  await enqueueTraktChangeInTransaction(tx, userId, {
    mediaId,
    category,
    value: typeof value.value === 'number' ? value.value : undefined,
    remove: value.value === false || value.value === null,
    excludeConnectionId,
  });
}
export async function trackWithExports(userId: string, input: TrackingInput) {
  return getDb().transaction(async (tx) => {
    const result = await trackInTransaction(tx, userId, input);
    if (
      result.changed &&
      result.eventId &&
      !result.reviewRequired &&
      !result.duplicate &&
      ['watch', 'unwatch', 'watchlist', 'collect'].includes(input.action)
    )
      await enqueueTraktChangeInTransaction(tx, userId, {
        mediaId: input.mediaId,
        category:
          input.action === 'watchlist'
            ? 'watchlist'
            : input.action === 'collect'
              ? 'collection'
              : 'history',
        remove: input.action === 'unwatch' || input.value === false,
        eventId: result.eventId,
      });
    if (result.changed && !result.reviewRequired && !result.duplicate)
      await enqueueJellyfinChange(
        tx,
        userId,
        input.mediaId,
        input.action,
        input.action === 'favourite' ? result.state.favourite : undefined
      );
    return result;
  });
}
export async function bulkTrackWithExports(
  userId: string,
  input: v.InferInput<typeof bulkTrackingInputSchema>
) {
  return getDb().transaction(async (tx) => {
    const result = await bulkTrackInTransaction(tx, userId, input);
    for (const event of result.events) {
      await enqueueJellyfinChange(tx, userId, event.mediaId, event.action);
      if (event.action === 'progress') continue;
      await enqueueTraktChangeInTransaction(tx, userId, {
        mediaId: event.mediaId,
        category: 'history',
        remove: event.action === 'unwatch',
        eventId: event.eventId,
      });
    }
    return result;
  });
}
export async function rateWithExports(
  userId: string,
  input: v.InferInput<typeof ratingInputSchema>
) {
  return getDb().transaction(async (tx) => {
    const result = await rateInTransaction(tx, userId, input);
    if (result.changed)
      await enqueueTraktChangeInTransaction(tx, userId, {
        mediaId: input.mediaId,
        category: 'ratings',
        value: input.value ?? undefined,
        remove: input.value === null,
      });
    return result.rating;
  });
}

/** Called under the user's tracking lock so state and playback provider intent commit together. */
export async function enqueuePlaybackActionsInTransaction(
  tx: Transaction,
  userId: string,
  input: {
    sessionId: string;
    connectionId: string;
    mediaId: string;
    jellyfinEvent: 'start' | 'progress' | 'stop';
    traktEvent?: 'start' | 'pause' | 'stop';
    positionSeconds: number;
    durationSeconds: number;
    paused: boolean;
  }
) {
  await enqueueInTransaction(tx, {
    userId,
    connectionId: input.connectionId,
    kind: 'jellyfin.scrobble',
    payload: {
      sessionId: input.sessionId,
      event: input.jellyfinEvent,
      positionSeconds: input.positionSeconds,
      paused: input.paused,
    },
    compactionKey:
      input.jellyfinEvent === 'progress' ? `playback:${input.sessionId}:progress` : undefined,
  });
  const connections = await traktConnectionsForMedia(tx, userId, input.mediaId);
  const progress = input.durationSeconds
    ? (input.positionSeconds / input.durationSeconds) * 100
    : 0;
  for (const { connection } of connections) {
    const sync = connection.settings.sync as Record<string, boolean> | undefined;
    if (sync?.scrobble && input.traktEvent)
      await enqueueInTransaction(tx, {
        userId,
        connectionId: connection.id,
        kind: 'trakt.scrobble',
        payload: {
          sessionId: input.sessionId,
          mediaId: input.mediaId,
          event: input.traktEvent,
          progress,
        },
      });
    else if (sync?.progress && !sync.scrobble && input.durationSeconds && progress < 90)
      await enqueueInTransaction(tx, {
        userId,
        connectionId: connection.id,
        kind: 'trakt.progress',
        payload: {
          sessionId: input.sessionId,
          mediaId: input.mediaId,
          progress,
        },
        compactionKey: `trakt-progress:${input.mediaId}`,
      });
  }
}
