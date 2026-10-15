import {
  reconcileProviderValue,
  acknowledgeProviderValue,
  localSyncValue,
  sameValue,
  type ValueCategory,
} from '$lib/sync/values.server';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  externalIds,
  media,
  episodes,
  trackingEvents,
  removedTrackingSources,
  syncValues,
  socialScrobbleDeliveries,
  providerConnections,
} from '$lib/server/db/schema';
import { PermanentActionError } from '$lib/server/queue';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import type { SyncPreferences } from '$lib/providers/contracts';
import type { TraktRecord, TraktAdapter } from '$lib/providers/trakt/adapter.server';
import { traktEntry, traktPlurals, exportIdentity } from '$lib/sync/trakt-identity.server';

/** Read the provider value before overwriting it; imports alone cannot detect edits made since the last sync. */
export async function readTraktValue(adapter: TraktAdapter, mediaId: string, category: ValueCategory) {
  const [item] = await getDb().select().from(media).where(eq(media.id, mediaId));
  if (!item || item.kind === 'collection' || category === 'favourite')
    throw new PermanentActionError('Unsupported Trakt value.');
  const identity = await exportIdentity(mediaId, item.kind);
  const matches = (record: TraktRecord) => {
    const entry = traktEntry(record);
    return (
      entry?.kind === item.kind &&
      Object.entries(identity).some(
        ([provider, id]) =>
          String(entry.item.ids[provider as keyof typeof entry.item.ids]) === String(id)
      )
    );
  };
  if (category === 'collection' && item.kind === 'episode') {
    const [episode] = await getDb()
      .select()
      .from(episodes)
      .where(eq(episodes.mediaId, mediaId));
    if (!episode) throw new PermanentActionError('Episode identity is missing.');
    const showIds = await exportIdentity(episode.showId, 'show');
    const shows = await adapter.collectionShows();
    return {
      value: shows.some(
        (record) =>
          record.show &&
          Object.entries(showIds).some(
            ([provider, id]) =>
              String(record.show!.ids[provider as keyof typeof record.show.ids]) === String(id)
          ) &&
          record.seasons?.some(
            (season) =>
              season.number === episode.seasonNumber &&
              season.episodes.some((entry) => entry.number === episode.episodeNumber)
          )
      ),
    };
  }
  for (let page = 1; page <= 10000; page++) {
    const records = await adapter.read(category, page);
    const record = records.find(matches);
    if (record) {
      if (category === 'ratings') return { value: record.rating ? record.rating / 2 : null };
      if (category === 'progress') {
        const duration = (item.runtimeMinutes ?? 0) * 60;
        return {
          positionSeconds: Math.round(duration * (record.progress ?? 0) * 10) / 1000,
          durationSeconds: duration,
        };
      }
      return { value: true };
    }
    if (records.length < 100) {
      return category === 'progress'
        ? { positionSeconds: 0, durationSeconds: (item.runtimeMinutes ?? 0) * 60 }
        : { value: category === 'ratings' ? null : false };
    }
  }
  throw new Error('Trakt value lookup exceeded the supported page bound.');
}

export async function executeTraktExport(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const context = await getTrakt(userId, connectionId);
  const category = input.category as ValueCategory;
  if (!['history', 'collection', 'ratings', 'watchlist'].includes(category))
    throw new PermanentActionError('Unsupported Trakt export.');
  if (!context.sync[category as keyof SyncPreferences]) return;
  const mediaId = String(input.mediaId);
  const desired = {
    value: category === 'ratings' ? (input.remove ? null : input.value) : !input.remove,
  };
  const local = await getDb().transaction((tx) =>
    localSyncValue(tx, userId, mediaId, category)
  );
  if (!sameValue(local, desired)) return;
  const remote = await readTraktValue(context.adapter, mediaId, category);
  const decision = await reconcileProviderValue(
    userId,
    connectionId,
    mediaId,
    category,
    remote,
    {
      source: 'trakt',
    }
  );
  if (decision === 'conflict' || decision === 'remote') return;
  await exportTraktToAdapter(userId, input, context);
  await acknowledgeProviderValue(userId, connectionId, String(input.mediaId), category, {
    value: category === 'ratings' ? (input.remove ? null : input.value) : !input.remove,
  });
}

/** Shared dispatch engine; only server-resolved adapters can reach it. */
export async function exportTraktToAdapter(
  userId: string,
  input: Record<string, unknown>,
  { adapter, sync }: { adapter: TraktAdapter; sync: SyncPreferences }
) {
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      category: v.picklist(['history', 'collection', 'ratings', 'watchlist']),
      remove: v.optional(v.boolean(), false),
      value: v.optional(v.number()),
      occurredAt: v.optional(v.string()),
      eventId: v.optional(v.string()),
    }),
    input
  );
  if (!sync[data.category]) return;
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  if (!item) throw new PermanentActionError('The Coast media item no longer exists.');
  if (item.kind === 'collection')
    throw new PermanentActionError('This media type cannot be exported to Trakt.');
  const ids = await exportIdentity(item.id, item.kind);
  if (!Object.keys(ids).length)
    throw new PermanentActionError('This title has no identity Trakt can match.');
  const plural = traktPlurals[item.kind];
  let occurredAt = data.occurredAt;
  if (data.eventId) {
    const [event] = await getDb()
      .select()
      .from(trackingEvents)
      .where(
        and(
          eq(trackingEvents.id, data.eventId),
          eq(trackingEvents.userId, userId),
          eq(trackingEvents.mediaId, item.id)
        )
      );
    if (!event) {
      const [removed] = await getDb()
        .select()
        .from(removedTrackingSources)
        .where(
          and(
            eq(removedTrackingSources.userId, userId),
            eq(removedTrackingSources.source, 'removed-coast-event'),
            eq(removedTrackingSources.sourceEventId, data.eventId)
          )
        );
      if (removed) return;
      throw new PermanentActionError('The export has no matching Coast event.');
    }
    if (data.category === 'history' && !data.remove && !event.occurredAtKnown)
      throw new PermanentActionError(
        'This completion has no known date. Dated history was not exported to Trakt.'
      );
    occurredAt = event.occurredAt.toISOString();
  }
  if (data.category === 'history' && !data.remove && !occurredAt)
    throw new PermanentActionError(
      'This completion has no known date. Dated history was not exported to Trakt.'
    );
  const record = {
    ids,
    ...(data.category === 'history' && occurredAt ? { watched_at: occurredAt } : {}),
    ...(data.category === 'ratings' && !data.remove
      ? { rating: Math.round((data.value || 0) * 2) }
      : {}),
  };
  if (
    data.category === 'history' &&
    !data.remove &&
    (item.kind === 'movie' || item.kind === 'episode')
  ) {
    let traktId = typeof ids.trakt === 'number' ? ids.trakt : undefined;
    if (!traktId && typeof ids.tmdb === 'number')
      traktId = (await adapter.lookupIds(item.kind, ids.tmdb))?.trakt;
    if (traktId) {
      const existing = await adapter.historyFor(item.kind, traktId, String(record.watched_at));
      if (
        existing.some(
          (event) =>
            event.watched_at &&
            new Date(event.watched_at).getTime() ===
              new Date(String(record.watched_at)).getTime()
        )
      )
        return;
    } else
      throw new PermanentActionError(
        'Trakt could not resolve this title for a retry-safe history export.'
      );
  }
  await adapter.write(data.category, { [plural]: [record] }, data.remove);
}

export async function executeLiveScrobble(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  return executeLiveScrobbleToAdapter(userId,connectionId,input,await getTrakt(userId,connectionId));
}
export async function executeLiveScrobbleToAdapter(userId:string,connectionId:string,input:Record<string,unknown>,{adapter,sync,connection}:Awaited<ReturnType<typeof getTrakt>>) {
  if(connection.userId!==userId||connection.id!==connectionId)throw new PermanentActionError('The connected account is unavailable.');
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      sessionId: v.pipe(v.string(), v.uuid()),
      event: v.picklist(['start', 'pause', 'stop']),
      progress: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
    }),
    input
  );
  if (!sync.scrobble) return;
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  if (!item || !['movie', 'episode'].includes(item.kind)) return;
  const mappings = await getDb()
    .select()
    .from(externalIds)
    .where(eq(externalIds.mediaId, data.mediaId));
  const ids = Object.fromEntries(
    mappings
      .filter((m) => ['trakt', 'tmdb', 'imdb', 'tvdb'].includes(m.provider))
      .map((m) => [m.provider, m.provider === 'imdb' ? m.externalId : Number(m.externalId)])
  );
  if (!Object.keys(ids).length) return;
  // Only completion can create history. Reserve its evidence before sending so a lost
  // response cannot silently become a second play on retry.
  const completion=data.event==='stop' && data.progress>=80 && data.sessionId;
  if(completion){
    const [previous]=await getDb().select().from(socialScrobbleDeliveries).where(and(eq(socialScrobbleDeliveries.connectionId,connectionId),eq(socialScrobbleDeliveries.sessionId,completion)));
    if(previous?.accountGeneration===connection.accountGeneration){
      if(previous.state==='confirmed')return;
      throw new PermanentActionError('Scrobble delivery is uncertain. Review Trakt history before retrying.');
    }
    await getDb().insert(socialScrobbleDeliveries).values({connectionId,sessionId:completion,workId:data.mediaId,accountGeneration:connection.accountGeneration,state:'uncertain'}).onConflictDoUpdate({target:[socialScrobbleDeliveries.connectionId,socialScrobbleDeliveries.sessionId],set:{accountGeneration:connection.accountGeneration,state:'uncertain',remoteId:null,updatedAt:new Date()}});
  }
  const result=await adapter.scrobble(data.event, item.kind as 'movie' | 'episode', ids, data.progress);
  if(completion){
    const response=v.parse(v.object({id:v.optional(v.number()),action:v.string()}),result);
    await getDb().transaction(async tx=>{
      const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
      if(current?.accountGeneration!==connection.accountGeneration)return;
      await tx.update(socialScrobbleDeliveries).set({remoteId:response.id?String(response.id):null,state:'confirmed',updatedAt:new Date()}).where(and(eq(socialScrobbleDeliveries.connectionId,connectionId),eq(socialScrobbleDeliveries.sessionId,completion),eq(socialScrobbleDeliveries.accountGeneration,connection.accountGeneration)));
    });
  }
}

export async function executeProgressExport(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      progress: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
      resolved: v.optional(v.boolean(), false),
      durationSeconds: v.optional(v.number()),
    }),
    input
  );
  const { adapter, sync } = await getTrakt(userId, connectionId);
  if (!sync.progress || (sync.scrobble && !data.resolved)) return;
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  if (!item || !['movie', 'episode'].includes(item.kind)) return;
  const mappings = await getDb()
    .select()
    .from(externalIds)
    .where(eq(externalIds.mediaId, item.id));
  const ids = Object.fromEntries(
    mappings
      .filter((m) => ['trakt', 'tmdb', 'tvdb', 'imdb'].includes(m.provider))
      .map((m) => [m.provider, m.provider === 'imdb' ? m.externalId : Number(m.externalId)])
  );
  if (!Object.keys(ids).length) return;
  const duration = data.durationSeconds ?? (item.runtimeMinutes ?? 0) * 60;
  const desired = {
    positionSeconds: Math.round(duration * data.progress * 10) / 1000,
    durationSeconds: duration,
  };
  if (data.resolved) {
    const local = await getDb().transaction((tx) =>
      localSyncValue(tx, userId, item.id, 'progress')
    );
    if (!sameValue(local, desired)) return;
    const remote = await readTraktValue(adapter, item.id, 'progress');
    const decision = await reconcileProviderValue(
      userId,
      connectionId,
      item.id,
      'progress',
      remote,
      { source: 'trakt' }
    );
    if (decision === 'conflict' || decision === 'remote') return;
  } else {
    const [pending] = await getDb()
      .select({ id: syncValues.id })
      .from(syncValues)
      .where(
        and(
          eq(syncValues.connectionId, connectionId),
          eq(syncValues.mediaId, item.id),
          eq(syncValues.category, 'progress'),
          eq(syncValues.conflict, true)
        )
      );
    if (pending) return;
  }
  if (data.progress === 0) await adapter.clearProgress(item.kind as 'movie' | 'episode', ids);
  else await adapter.scrobble('pause', item.kind as 'movie' | 'episode', ids, data.progress);
  await acknowledgeProviderValue(userId, connectionId, item.id, 'progress', desired);
}
