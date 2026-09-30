import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import * as s from '$lib/server/db/schema';
import { DomainError } from '$lib/core/errors';
import { historyScope } from '$lib/core/tracking/history-scope';
import { rebuildHistoryInTransaction } from '$lib/core/tracking/service';
import { enqueueInTransaction } from './changes';
import { acknowledgeProviderValue } from './values';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import { PermanentActionError } from '$lib/server/queue';
const uuid = v.pipe(v.string(), v.uuid());
const inputSchema = v.object({
  eventIds: v.array(uuid),
  excludedIds: v.optional(v.array(uuid), []),
  all: v.optional(v.boolean(), false),
  expectedCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  before: v.pipe(v.string(), v.isoTimestamp()),
});
const summary = (state: typeof s.trackingState.$inferSelect) => ({
  watched: state.watched,
  playCount: state.playCount,
  positionSeconds: state.positionSeconds,
  lastWatchedAt: state.lastWatchedAt?.toISOString() ?? null,
});
export async function removeHistory(userId: string, mediaId: string, raw: unknown) {
  v.parse(uuid, mediaId);
  const input = v.parse(inputSchema, raw);
  if (!input.all && !input.eventIds.length) throw new DomainError('Select history entries first.');
  if (Date.parse(input.before) > Date.now())
    throw new DomainError('Refresh history before removing entries.');
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const entries = await tx
      .select()
      .from(s.trackingEvents)
      .where(
        and(
          eq(s.trackingEvents.userId, userId),
          sql`${s.trackingEvents.mediaId} in (${historyScope(mediaId)})`,
          inArray(s.trackingEvents.action, ['watch', 'unwatch', 'progress']),
          sql`${s.trackingEvents.createdAt} <= ${new Date(input.before)}`,
          input.all
            ? input.excludedIds.length
              ? notInArray(s.trackingEvents.id, input.excludedIds)
              : undefined
            : inArray(s.trackingEvents.id, input.eventIds)
        )
      );
    if (
      entries.length !== input.expectedCount ||
      (!input.all && entries.length !== new Set(input.eventIds).size)
    )
      throw new DomainError(
        'History changed or some entries are outside this title. Refresh and select them again.',
        409
      );
    const mediaIds = [...new Set(entries.map((entry) => entry.mediaId))];
    const previous = await tx
      .select()
      .from(s.trackingState)
      .where(and(eq(s.trackingState.userId, userId), inArray(s.trackingState.mediaId, mediaIds)));
    const connections = await tx
      .select({ connection: s.providerConnections, provider: s.providerInstances.provider })
      .from(s.providerConnections)
      .innerJoin(s.providerInstances, eq(s.providerInstances.id, s.providerConnections.instanceId))
      .where(
        and(
          eq(s.providerConnections.userId, userId),
          eq(s.providerConnections.status, 'connected'),
          eq(s.providerInstances.enabled, true),
          inArray(s.providerInstances.provider, ['jellyfin', 'trakt'])
        )
      )
      .orderBy(asc(s.providerConnections.id));
    const conflicts = await tx
      .select({ id: s.syncValues.id })
      .from(s.syncValues)
      .where(
        and(
          sql`${s.syncValues.connectionId} in (select id from provider_connections where user_id=${userId})`,
          inArray(s.syncValues.mediaId, mediaIds),
          inArray(s.syncValues.category, ['history', 'progress']),
          eq(s.syncValues.conflict, true)
        )
      );
    if (conflicts.length)
      throw new DomainError(
        'Resolve the history or progress sync conflicts for these titles before removing entries.',
        409
      );
    await tx
      .insert(s.removedTrackingSources)
      .values(
        entries.flatMap((entry) => [
          { userId, source: 'removed-coast-event', sourceEventId: entry.id },
          ...(entry.sourceEventId
            ? [{ userId, source: entry.source, sourceEventId: entry.sourceEventId }]
            : []),
        ])
      )
      .onConflictDoNothing();
    await tx
      .update(s.outboxActions)
      .set({ state: 'cancelled', lastError: 'History entry removed.', updatedAt: new Date() })
      .where(
        and(
          eq(s.outboxActions.userId, userId),
          inArray(s.outboxActions.state, ['pending', 'failed']),
          sql`${s.outboxActions.payload}->>'eventId' in (${sql.join(
            entries.map((entry) => sql`${entry.id}`),
            sql`,`
          )})`
        )
      );
    await tx.delete(s.trackingEvents).where(
      inArray(
        s.trackingEvents.id,
        entries.map((entry) => entry.id)
      )
    );
    await rebuildHistoryInTransaction(tx, userId, mediaIds, entries);
    let queued = 0;
    for (const id of mediaIds) {
      const [state] = await tx
        .select()
        .from(s.trackingState)
        .where(and(eq(s.trackingState.userId, userId), eq(s.trackingState.mediaId, id)));
      const old = previous.find((row) => row.mediaId === id);
      if (!state || !old) continue;
      for (const { connection, provider } of connections) {
        const events = entries.filter((entry) => entry.mediaId === id);
        if (provider === 'jellyfin') {
          const [mapping] = await tx
            .select({ id: s.availability.id })
            .from(s.availability)
            .where(
              and(
                eq(s.availability.userId, userId),
                eq(s.availability.connectionId, connection.id),
                eq(s.availability.mediaId, id)
              )
            )
            .limit(1);
          if (!mapping) continue;
        } else if (!events.some((event) => event.action === 'watch' || event.action === 'progress'))
          continue;
        // Keep old remote values as the comparison baseline until the queued correction finishes.
        for (const category of ['history', 'progress'] as const) {
          const value =
            category === 'history'
              ? { value: old.watched }
              : { positionSeconds: old.positionSeconds, durationSeconds: old.durationSeconds ?? 0 };
          await tx
            .insert(s.syncValues)
            .values({
              connectionId: connection.id,
              mediaId: id,
              category,
              remote: value,
              agreed: value,
            })
            .onConflictDoNothing();
        }
        await enqueueInTransaction(tx, {
          userId,
          connectionId: connection.id,
          kind: 'history.remove',
          payload: {
            mediaId: id,
            provider,
            category: 'history',
            before: summary(old),
            after: summary(state),
            events: events.map((event) => ({
              action: event.action,
              source: event.source,
              sourceEventId: event.sourceEventId,
              occurredAt: event.occurredAtKnown ? event.occurredAt.toISOString() : null,
            })),
          },
        });
        queued++;
      }
    }
    return { removed: entries.length, queued };
  });
}

type RemovalEvent = {
  action: string;
  source: string;
  sourceEventId: string | null;
  occurredAt: string | null;
};
/** Exact history IDs only: never send media IDs to Trakt's destructive history endpoint. */
export async function removeTraktHistory(
  adapter: Awaited<ReturnType<typeof getTrakt>>['adapter'],
  connectionId: string,
  kind: 'movie' | 'episode',
  ids: Record<string, string | number>,
  events: RemovalEvent[]
) {
  const removals = new Set<number>();
  for (const event of events.filter((entry) => entry.action === 'watch')) {
    const source =
      event.source === 'trakt' && event.sourceEventId?.startsWith(`${connectionId}:history:`)
        ? event.sourceEventId.split(':')[2]
        : undefined;
    if (source && /^\d+$/.test(source) && Number.isSafeInteger(Number(source))) {
      removals.add(Number(source));
      continue;
    }
    if (!event.occurredAt)
      throw new PermanentActionError(
        'A watch has no date or matching Trakt history ID. Remove that entry in Trakt manually.'
      );
    let traktId = Number(ids.trakt) || undefined;
    if (!traktId)
      for (const provider of ['tmdb', 'tvdb', 'imdb']) {
        if (ids[provider]) {
          traktId = (await adapter.lookupIds(kind, ids[provider], provider))?.trakt;
          if (traktId) break;
        }
      }
    if (!traktId)
      throw new PermanentActionError(
        'This title could not be matched to Trakt. No Trakt history was removed.'
      );
    const matches = (await adapter.historyFor(kind, traktId, event.occurredAt)).filter(
      (row) => row.watched_at && Date.parse(row.watched_at) === Date.parse(event.occurredAt!)
    );
    if (matches.length > 1)
      throw new PermanentActionError(
        'Multiple Trakt watches share this timestamp. Choose the entry in Trakt manually.'
      );
    if (matches[0]?.id) removals.add(matches[0].id);
  }
  if (removals.size) await adapter.write('history', { ids: [...removals] }, true);
}
export async function executeHistoryRemoval(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      mediaId: uuid,
      provider: v.picklist(['jellyfin', 'trakt']),
      before: v.object({
        watched: v.boolean(),
        playCount: v.number(),
        positionSeconds: v.number(),
        lastWatchedAt: v.nullable(v.string()),
      }),
      after: v.object({
        watched: v.boolean(),
        playCount: v.number(),
        positionSeconds: v.number(),
        lastWatchedAt: v.nullable(v.string()),
      }),
      events: v.array(
        v.object({
          action: v.string(),
          source: v.string(),
          sourceEventId: v.nullable(v.string()),
          occurredAt: v.nullable(v.string()),
        })
      ),
    }),
    input
  );
  const db = getDb();
  if (data.provider === 'trakt') {
    const { adapter } = await getTrakt(userId, connectionId);
    const [item] = await db.select().from(s.media).where(eq(s.media.id, data.mediaId));
    if (!item || !['movie', 'episode'].includes(item.kind)) return;
    const mappings = await db
      .select()
      .from(s.externalIds)
      .where(eq(s.externalIds.mediaId, data.mediaId));
    const ids = Object.fromEntries(
      mappings.map((mapping) => [mapping.provider, mapping.externalId])
    );
    await removeTraktHistory(
      adapter,
      connectionId,
      item.kind as 'movie' | 'episode',
      ids,
      data.events
    );
    // Progress records are distinct from completed history. Do not erase newer remote playback.
    const progress = data.events.filter((event) => event.action === 'progress');
    if (progress.length)
      await adapter.clearProgress(item.kind as 'movie' | 'episode', ids, {
        ids: progress.flatMap((event) =>
          event.source === 'trakt' && event.sourceEventId?.startsWith(`${connectionId}:progress:`)
            ? [Number(event.sourceEventId.split(':')[2])].filter(Number.isSafeInteger)
            : []
        ),
        dates: progress.flatMap((event) => (event.occurredAt ? [event.occurredAt] : [])),
      });
  } else {
    const { adapter, connection } = await getJellyfin(userId, connectionId);
    const [current] = await db
      .select()
      .from(s.trackingState)
      .where(and(eq(s.trackingState.userId, userId), eq(s.trackingState.mediaId, data.mediaId)));
    if (!current || JSON.stringify(summary(current)) !== JSON.stringify(data.after))
      throw new PermanentActionError(
        'Coast progress changed after removal. Review the Jellyfin correction before retrying.'
      );
    const items = await db
      .selectDistinct({ id: s.providerItems.externalId })
      .from(s.availability)
      .innerJoin(s.providerItems, eq(s.providerItems.id, s.availability.providerItemId))
      .where(
        and(
          eq(s.availability.userId, userId),
          eq(s.availability.connectionId, connectionId),
          eq(s.availability.mediaId, data.mediaId)
        )
      );
    const corrections: string[] = [];
    for (const item of items) {
      const remote = (await adapter.item(connection.externalUserId!, item.id)).userData;
      if (!remote)
        throw new PermanentActionError(
          'Jellyfin did not return viewing information for this title.'
        );
      const matches = (state: typeof data.before) =>
        remote.played === state.watched &&
        remote.playCount === state.playCount &&
        (state.watched || Math.abs(remote.positionSeconds - state.positionSeconds) < 1) &&
        (remote.lastPlayedAt ? Date.parse(remote.lastPlayedAt) : null) ===
          (state.lastWatchedAt ? Date.parse(state.lastWatchedAt) : null);
      if (matches(data.after)) continue;
      if (!matches(data.before))
        throw new PermanentActionError(
          'Jellyfin has different viewing history. No Jellyfin data was changed; review this correction.'
        );
      corrections.push(item.id);
    }
    for (const id of corrections)
      await adapter.setViewingSummary(connection.externalUserId!, id, data.after);
    await acknowledgeProviderValue(userId, connectionId, data.mediaId, 'history', {
      value: data.after.watched,
    });
    await acknowledgeProviderValue(userId, connectionId, data.mediaId, 'progress', {
      positionSeconds: current.positionSeconds,
      durationSeconds: current.durationSeconds ?? 0,
    });
  }
}
