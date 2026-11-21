import { requireFeature } from '#lib/server/features.js';
import {
  reconcileProviderValue,
  acknowledgeProviderValue,
  localSyncValue,
  sameValue,
  type ValueCategory,
} from '#lib/sync/values.server.js';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import {
  media,
  episodes,
  trackingEvents,
  removedTrackingSources,
  syncValues,
  socialScrobbleDeliveries,
  providerConnections,
} from '#lib/server/db/schema.js';
import { PermanentActionError } from '#lib/server/queue/index.js';
import { getTrakt } from '#lib/providers/trakt/connection.server.js';
import type { SyncPreferences } from '#lib/providers/contracts.js';
import type { TraktRecord, TraktAdapter } from '#lib/providers/trakt/adapter.server.js';
import { traktEntry, traktPlurals, exportIdentity } from '#lib/sync/trakt-identity.server.js';

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
    if(identity.trakt){
      for await(const page of adapter.collectionEpisodePages())
        if(page.some(record=>record.episode.ids.trakt===identity.trakt))return {value:true};
      return {value:false};
    }
    const [episode] = await getDb()
      .select()
      .from(episodes)
      .where(eq(episodes.mediaId, mediaId));
    if (!episode) throw new PermanentActionError('Episode identity is missing.');
    const showIds = await exportIdentity(episode.showId, 'show');
    for await (const page of adapter.collectionEpisodePages()) {
      if (page.some(record => {
        const comparable=Object.keys(identity).filter(provider=>record.episode.ids[provider as keyof typeof record.episode.ids]!=null);
        if(comparable.length)return matches(record);
        return record.episode.season === episode.seasonNumber && record.episode.number === episode.episodeNumber &&
          Object.entries(showIds).some(([provider,id]) => String(record.show.ids[provider as keyof typeof record.show.ids]) === String(id));
      })) return { value:true };
    }
    return { value:false };
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
  const category = input.category as ValueCategory;
  if (!['history', 'collection', 'ratings', 'watchlist'].includes(category))
    throw new PermanentActionError('Unsupported Trakt export.');
  const context = await getTrakt(userId, connectionId, 'export', category === 'favourite' ? undefined : category);
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
      source: 'trakt', traktDirection: 'export', accountGeneration: context.connection.accountGeneration,
    }
  );
  if (decision === 'conflict') return {applied:0,review:1};
  if (decision === 'remote') return;
  await exportTraktToAdapter(userId, input, context);
  await acknowledgeProviderValue(userId, connectionId, String(input.mediaId), category, {
    value: category === 'ratings' ? (input.remove ? null : input.value) : !input.remove,
  },context.connection.accountGeneration);
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
  return executeLiveScrobbleToAdapter(userId,connectionId,input,await getTrakt(userId,connectionId, 'export', 'scrobble'));
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
  await requireFeature(userId,'presence');
  await requireFeature(userId,'screen');
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  if (!item || (item.kind !== 'movie' && item.kind !== 'episode')) return;
  const ids = await exportIdentity(item.id, item.kind);
  if (!Object.keys(ids).length) return {skipped:1};
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
  const receipt=await adapter.scrobble(data.event, item.kind as 'movie' | 'episode', ids, data.progress);
  if(completion){
    if(receipt.action!=='scrobble')throw new PermanentActionError('Trakt did not confirm a completed play. Review Trakt history before retrying.');
    await getDb().transaction(async tx=>{
      const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
      if(current?.accountGeneration!==connection.accountGeneration)return;
      await tx.update(socialScrobbleDeliveries).set({remoteId:String(receipt.id),state:'confirmed',updatedAt:new Date()}).where(and(eq(socialScrobbleDeliveries.connectionId,connectionId),eq(socialScrobbleDeliveries.sessionId,completion),eq(socialScrobbleDeliveries.accountGeneration,connection.accountGeneration)));
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
  const { adapter, sync, connection } = await getTrakt(userId, connectionId, 'export', 'progress');
  if (!sync.progress || (sync.scrobble && !data.resolved)) return;
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  if (!item || (item.kind !== 'movie' && item.kind !== 'episode')) return;
  const ids = await exportIdentity(item.id, item.kind);
  if (!Object.keys(ids).length) return {skipped:1};
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
      { source: 'trakt', traktDirection: 'export', accountGeneration: connection.accountGeneration }
    );
    if (decision === 'conflict') return {applied:0,review:1};
    if (decision === 'remote') return;
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
    if (pending) return {applied:0,review:1};
  }
  if (data.progress === 0) await adapter.clearProgress(item.kind as 'movie' | 'episode', ids);
  else await adapter.scrobble('pause', item.kind as 'movie' | 'episode', ids, data.progress);
  await acknowledgeProviderValue(userId, connectionId, item.id, 'progress', desired, connection.accountGeneration);
}
