import { reconcileProviderList, acknowledgeProviderList } from './list-values';
import {
  reconcileProviderValue,
  acknowledgeProviderValue,
  localSyncValue,
  sameValue,
  type ValueCategory,
} from './values';
import { importJellyfinPlayback } from './jellyfin-playback';
import { artworkKeys } from '$lib/artwork';
import * as v from 'valibot';
import { and, eq, isNull, ne, or, sql, asc, desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  availability,
  providerItems,
  syncCheckpoints,
  externalIds,
  media,
  seasons,
  episodes,
  lists,
  listItems,
  providerConnections,
  trackingEvents,
  removedTrackingSources,
  trackingState,
  outboxActions,
  syncValues,
  syncListValues,
} from '$lib/server/db/schema';
import { enqueueAction, PermanentActionError } from '$lib/server/queue';
import { notify } from '$lib/server/notifications';
import { getJellyfin, getTrakt } from '$lib/providers/service';
import { ingestMetadata, importTmdb, getTmdb } from '$lib/catalogue/service';
import { trackInTransaction } from '$lib/core/tracking/service';
import type {
  AvailableItem,
  Metadata,
  SyncCategory,
  SyncPreferences,
} from '$lib/providers/contracts';
import type { TraktRecord, TraktAdapter } from '$lib/providers/trakt/adapter.server';

export async function queueLibraryScan(userId: string, connectionId: string, full = true) {
  await getJellyfin(userId, connectionId);
  return enqueueAction({
    userId,
    connectionId,
    kind: 'jellyfin.scan',
    payload: { full },
    compactionKey: `jellyfin-scan:${full}`,
  });
}
export async function libraryScanProgress(userId: string, connectionId: string) {
  const { connection } = await getJellyfin(userId, connectionId);
  const [job] = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(
        eq(outboxActions.userId, userId),
        eq(outboxActions.connectionId, connectionId),
        eq(outboxActions.kind, 'jellyfin.scan')
      )
    )
    .orderBy(desc(outboxActions.createdAt))
    .limit(1);
  if (!job) return null;
  const parsed = v.safeParse(
    v.object({
      processed: v.number(),
      total: v.nullable(v.number()),
      startedAt: v.string(),
      phase: v.picklist(['scanning', 'reconciling', 'complete']),
    }),
    connection.settings.libraryScan
  );
  const current =
    parsed.success && new Date(parsed.output.startedAt) >= job.createdAt ? parsed.output : null;
  const [checkpoint] = current
    ? []
    : await getDb()
        .select()
        .from(syncCheckpoints)
        .where(
          and(
            eq(syncCheckpoints.connectionId, connectionId),
            eq(
              syncCheckpoints.kind,
              job.payload.full === false ? 'jellyfin-recent' : 'jellyfin-full'
            )
          )
        )
        .limit(1);
  const checkpointCount =
    checkpoint && checkpoint.updatedAt >= job.createdAt ? Number(checkpoint.cursor ?? 0) : 0;
  return {
    state: job.state,
    processed: current?.processed ?? (Number.isSafeInteger(checkpointCount) ? checkpointCount : 0),
    total: current?.total ?? null,
    phase: current?.phase ?? 'scanning',
    error: job.lastError,
    attempts: job.attempts,
  };
}

/** Resume at committed page boundaries; removal only occurs after a successful full traversal. */
export async function scanJellyfin(userId: string, connectionId: string, full = true) {
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  await adapter.identity(instance.serverIdentity || undefined);
  const db = getDb(),
    kind = full ? 'jellyfin-full' : 'jellyfin-recent';
  const [checkpoint] = await db
    .select()
    .from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
  const scanId = checkpoint?.cursor && checkpoint.scanId ? checkpoint.scanId : crypto.randomUUID();
  let offset = checkpoint?.cursor ? Number(checkpoint.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
  const since =
    !full && connection.settings.importPlayback !== true && checkpoint?.completedAt
      ? new Date(checkpoint.completedAt.getTime() - 60000).toISOString()
      : undefined;
  const startedAt = new Date().toISOString();
  async function report(processed: number, total: number | null, phase = 'scanning') {
    const progress = { processed, total, phase, startedAt };
    await db
      .update(providerConnections)
      .set({
        settings: sql`jsonb_set(${providerConnections.settings}, '{libraryScan}', ${progress}::jsonb, true)`,
      })
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
  }
  await report(offset, null);
  const visited = new Map<string, string>();
  let importPlayback = connection.settings.importPlayback === true;
  const importItem = async (item: AvailableItem, ancestry = new Set<string>()): Promise<string> => {
    if (visited.has(item.id)) return visited.get(item.id)!;
    if (ancestry.has(item.id)) throw new Error('Jellyfin returned a cyclic media hierarchy.');
    ancestry.add(item.id);
    let showId: string | undefined, seasonId: string | undefined;
    if (item.kind === 'episode' || item.kind === 'season') {
      if (!item.showId) throw new Error('Jellyfin returned an item without its show identity.');
      const [parent] = await db
        .select()
        .from(providerItems)
        .where(
          and(eq(providerItems.instanceId, instance.id), eq(providerItems.externalId, item.showId))
        )
        .limit(1);
      showId =
        parent?.mediaId ||
        (await importItem(await adapter.item(connection.externalUserId!, item.showId), ancestry));
      if (item.kind === 'episode') {
        const [existing] = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, item.seasonNumber ?? 0)));
        if (existing) seasonId = existing.mediaId;
        else if (item.parentId)
          seasonId = await importItem(
            await adapter.item(connection.externalUserId!, item.parentId),
            ancestry
          );
      }
    }
    item.metadata.artwork = Object.fromEntries(
      artworkKeys.flatMap((type) => {
        const image = item.artwork?.[type];
        return image
          ? [
              [
                type,
                `/api/v1/artwork/${instance.id}/${encodeURIComponent(item.id)}/${type}?tag=${encodeURIComponent(image.tag)}&index=${image.index}`,
              ],
            ]
          : [];
      })
    );
    item.metadata.posterPath = item.metadata.artwork.primary;
    item.metadata.backdropPath = item.metadata.artwork.backdrop;
    const saved = await ingestMetadata(item.metadata, {
      instanceId: instance.id,
      showId,
      seasonId,
    });
    visited.set(item.id, saved.id);
    const [providerItem] = await db
      .insert(providerItems)
      .values({
        instanceId: instance.id,
        externalId: item.id,
        kind: item.kind,
        mediaId: saved.id,
        snapshot: { ...item.metadata },
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [providerItems.instanceId, providerItems.externalId],
        set: { mediaId: saved.id, snapshot: { ...item.metadata }, lastSeenAt: new Date() },
      })
      .returning();
    const [wasAvailable] = await db
      .select({ id: availability.id })
      .from(availability)
      .where(
        and(
          eq(availability.userId, userId),
          eq(availability.mediaId, saved.id),
          eq(availability.state, 'available')
        )
      )
      .limit(1);
    const sources = item.sources.length
      ? item.sources
      : [
          {
            id: 'default',
            name: 'Original',
            container: undefined,
            bitrate: undefined,
            durationSeconds: item.metadata.runtimeMinutes
              ? item.metadata.runtimeMinutes * 60
              : undefined,
            streams: [],
            raw: {},
          },
        ];
    for (const source of sources) {
      const video = source.streams.find((s) => s.type === 'Video'),
        audio = source.streams.find((s) => s.type === 'Audio');
      const data = {
        userId,
        connectionId,
        providerItemId: providerItem.id,
        mediaId: saved.id,
        sourceId: source.id,
        edition: source.name,
        container: source.container,
        videoCodec: video?.codec,
        audioCodec: audio?.codec,
        bitrate: source.bitrate,
        width: video?.width,
        height: video?.height,
        durationSeconds: source.durationSeconds,
        source: { ...source.raw },
        state: 'available' as const,
        verifiedAt: new Date(),
        scanId,
      };
      await db
        .insert(availability)
        .values(data)
        .onConflictDoUpdate({
          target: [
            availability.userId,
            availability.connectionId,
            availability.providerItemId,
            availability.sourceId,
          ],
          set: data,
        });
    }
    if (!wasAvailable) {
      const [state] = await db
        .select()
        .from(trackingState)
        .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, saved.id)));
      if (state?.watchlist)
        await notify({
          userId,
          kind: 'availability',
          title: `${saved.title} is available`,
          body: 'A title on your watchlist is now in your library.',
          sourceKey: `available:${saved.id}`,
        });
    }
    if (importPlayback) await importJellyfinPlayback(userId, connectionId, saved.id, item);
    return saved.id;
  };
  let count = 0;
  for (;;) {
    const [current] = await db
      .select({ settings: providerConnections.settings })
      .from(providerConnections)
      .where(eq(providerConnections.id, connectionId));
    importPlayback = current?.settings.importPlayback === true;
    const page = await adapter.library(
      connection.externalUserId!,
      offset,
      importPlayback ? undefined : since
    );
    await report(offset, page.total);
    for (const [index, item] of page.items.entries()) {
      await importItem(item);
      count++;
      if ((index + 1) % 25 === 0 || index === page.items.length - 1)
        await report(offset + index + 1, page.total);
    }
    await db
      .insert(syncCheckpoints)
      .values({
        connectionId,
        kind,
        cursor: page.nextOffset === null ? null : String(page.nextOffset),
        scanId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [syncCheckpoints.connectionId, syncCheckpoints.kind],
        set: {
          cursor: page.nextOffset === null ? null : String(page.nextOffset),
          scanId,
          updatedAt: new Date(),
        },
      });
    if (page.nextOffset === null) {
      await report(offset + page.items.length, page.total, 'reconciling');
      break;
    }
    offset = page.nextOffset;
  }
  await db.transaction(async (tx) => {
    if (full)
      await tx
        .update(availability)
        .set({ state: 'unavailable', verifiedAt: new Date() })
        .where(
          and(
            eq(availability.userId, userId),
            eq(availability.connectionId, connectionId),
            or(ne(availability.scanId, scanId), isNull(availability.scanId))
          )
        );
    await tx
      .update(syncCheckpoints)
      .set({ cursor: null, scanId: null, completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
  });
  await db
    .update(providerConnections)
    .set({
      settings: sql`jsonb_set(${providerConnections.settings}, '{libraryScan,phase}', '"complete"'::jsonb, true)`,
    })
    .where(eq(providerConnections.id, connectionId));
  return { count, full };
}
/** A season/episode record also includes its show; the leaf determines identity. */
function traktEntry(record: TraktRecord) {
  if (record.movie) return { kind: 'movie' as const, item: record.movie };
  if (record.episode) return { kind: 'episode' as const, item: record.episode };
  if (record.season) return { kind: 'season' as const, item: record.season };
  if (record.show) return { kind: 'show' as const, item: record.show };
  return null;
}
async function resolveTrakt(record: TraktRecord): Promise<typeof media.$inferSelect | null> {
  const entry = traktEntry(record);
  if (!entry) return null;
  const { item: primary, kind } = entry;
  const [mapping] = await getDb()
    .select()
    .from(externalIds)
    .where(
      and(
        eq(externalIds.provider, 'trakt'),
        eq(externalIds.externalId, String(primary.ids.trakt)),
        eq(externalIds.mediaKind, kind)
      )
    )
    .limit(1);
  if (mapping) {
    const [item] = await getDb().select().from(media).where(eq(media.id, mapping.mediaId));
    return item;
  }
  const ids = Object.fromEntries(
    Object.entries(primary.ids)
      .filter(([key, val]) => key !== 'slug' && val !== null && val !== undefined)
      .map(([key, val]) => [key, String(val)])
  );
  if (kind === 'movie' || kind === 'show') {
    if (primary.ids.tmdb && (await getTmdb())) {
      const item = await importTmdb(kind, String(primary.ids.tmdb), { includeEpisodes: false });
      await getDb()
        .insert(externalIds)
        .values({
          mediaId: item.id,
          provider: 'trakt',
          externalId: String(primary.ids.trakt),
          mediaKind: kind,
        })
        .onConflictDoNothing();
      return item;
    }
    return ingestMetadata({
      provider: 'trakt',
      externalId: String(primary.ids.trakt),
      kind,
      title: primary.title || 'Untitled',
      runtimeMinutes: 'runtime' in primary ? (primary.runtime ?? undefined) : undefined,
      externalIds: ids,
    });
  }
  if (!record.show) return null;
  const show = await resolveTrakt({ show: record.show });
  if (!show) return null;
  if (kind === 'season' && record.season)
    return ingestMetadata(
      {
        provider: 'trakt',
        externalId: String(record.season.ids.trakt),
        kind: 'season',
        title:
          record.season.title ||
          (record.season.number === 0 ? 'Specials' : `Season ${record.season.number}`),
        seasonNumber: record.season.number,
        externalIds: ids,
      },
      { showId: show.id }
    );
  if (!record.episode) return null;
  const [existing] = await getDb()
    .select()
    .from(seasons)
    .where(and(eq(seasons.showId, show.id), eq(seasons.seasonNumber, record.episode.season)));
  const season = existing || {
    mediaId: (
      await ingestMetadata(
        {
          provider: 'trakt',
          externalId: `${record.show.ids.trakt}:season:${record.episode.season}`,
          kind: 'season',
          title: record.episode.season === 0 ? 'Specials' : `Season ${record.episode.season}`,
          seasonNumber: record.episode.season,
        },
        { showId: show.id }
      )
    ).id,
  };
  return ingestMetadata(
    {
      provider: 'trakt',
      externalId: String(record.episode.ids.trakt),
      kind: 'episode',
      title: record.episode.title || `Episode ${record.episode.number}`,
      seasonNumber: record.episode.season,
      episodeNumber: record.episode.number,
      runtimeMinutes: record.episode.runtime ?? undefined,
      externalIds: ids,
    },
    { showId: show.id, seasonId: season.mediaId }
  );
}
export async function queueTraktImport(userId: string, connectionId: string) {
  await getTrakt(userId, connectionId);
  return enqueueAction({
    userId,
    connectionId,
    kind: 'trakt.import',
    payload: {},
    compactionKey: 'trakt-import',
  });
}
export async function importTrakt(userId: string, connectionId: string) {
  return importTraktFromAdapter(userId, connectionId, await getTrakt(userId, connectionId));
}
/** Internal engine: service entrypoints resolve the authenticated connection before supplying capabilities. */
export async function importTraktFromAdapter(
  userId: string,
  connectionId: string,
  { adapter, sync }: { adapter: TraktAdapter; sync: SyncPreferences }
) {
  let imported = 0,
    review = 0;
  const seen = new Set<string>();
  const apply = async (
    category: Exclude<SyncCategory, 'lists' | 'scrobble'>,
    record: TraktRecord
  ) => {
    const item = await resolveTrakt(record);
    if (!item) return;
    const timestamp =
      record.watched_at ||
      record.paused_at ||
      record.rated_at ||
      record.collected_at ||
      record.listed_at;
    const sourceEventId = `${connectionId}:${category}:${record.id ?? traktEntry(record)?.item.ids.trakt}:${timestamp || 'initial'}`;
    if (category === 'history') {
      const [removed] = await getDb()
        .select()
        .from(removedTrackingSources)
        .where(
          and(
            eq(removedTrackingSources.userId, userId),
            eq(removedTrackingSources.source, 'trakt'),
            eq(removedTrackingSources.sourceEventId, sourceEventId)
          )
        );
      if (removed) return;
    }
    if (category === 'ratings') {
      if (record.rating && record.rating >= 1 && record.rating <= 10) {
        const decision = await reconcileProviderValue(
          userId,
          connectionId,
          item.id,
          category,
          { value: record.rating / 2 },
          { source: 'trakt' }
        );
        if (decision === 'conflict') review++;
        else if (decision === 'remote') imported++;
        seen.add(item.id);
      }
      return;
    }
    if (
      (category === 'history' || category === 'progress') &&
      (item.kind === 'show' || item.kind === 'season')
    )
      return;
    const duration = (item.runtimeMinutes || 0) * 60;
    if (category === 'progress' && !duration) return;
    seen.add(item.id);
    const remote =
      category === 'progress'
        ? {
            positionSeconds: Math.round(((duration * (record.progress || 0)) / 100) * 1000) / 1000,
            durationSeconds: duration,
          }
        : { value: true };
    const decision = await reconcileProviderValue(userId, connectionId, item.id, category, remote, {
      source: 'trakt',
      occurredAt: timestamp,
      ...(category === 'history'
        ? {
            apply: (tx) =>
              trackInTransaction(tx, userId, {
                mediaId: item.id,
                action: 'watch',
                source: 'trakt',
                sourceEventId,
                occurredAt: timestamp,
                rewatch: true,
              }),
          }
        : {}),
    });
    if (decision === 'conflict') review++;
    else if (decision === 'remote') imported++;
  };
  for (const category of ['history', 'progress', 'collection', 'ratings', 'watchlist'] as const) {
    if (!sync[category]) continue;
    seen.clear();
    const history: TraktRecord[] = [];
    for (let page = 1; ; page++) {
      const records = await adapter.read(category, page);
      if (category === 'history') history.push(...records);
      else for (const record of records) await apply(category, record);
      if (records.length < 100 || category === 'collection') break;
      if (page >= 10000) throw new Error('Trakt import exceeded the supported page bound.');
    }
    if (category === 'history') {
      history.sort((a, b) => (a.watched_at || '').localeCompare(b.watched_at || ''));
      for (const record of history) await apply(category, record);
    }
    if (category === 'collection')
      for (const record of await adapter.collectionShows()) {
        const show = await resolveTrakt(record);
        if (!show) continue;
        await apply(category, record);
        for (const season of record.seasons || [])
          for (const episode of season.episodes) {
            const shell: Metadata = {
              provider: 'trakt',
              externalId: `${record.show!.ids.trakt}:episode:${season.number}:${episode.number}`,
              kind: 'episode',
              title: `Episode ${episode.number}`,
              seasonNumber: season.number,
              episodeNumber: episode.number,
            };
            const item = await ingestMetadata(shell, { showId: show.id });
            seen.add(item.id);
            await reconcileProviderValue(
              userId,
              connectionId,
              item.id,
              'collection',
              { value: true },
              { source: 'trakt' }
            );
          }
      }
    const previous = await getDb()
      .select()
      .from(syncValues)
      .where(and(eq(syncValues.connectionId, connectionId), eq(syncValues.category, category)));
    for (const entry of previous)
      if (!seen.has(entry.mediaId)) {
        const remote =
          category === 'ratings'
            ? { value: null }
            : category === 'progress'
              ? { positionSeconds: 0, durationSeconds: Number(entry.remote.durationSeconds) || 0 }
              : { value: false };
        const decision = await reconcileProviderValue(
          userId,
          connectionId,
          entry.mediaId,
          category,
          remote,
          { source: 'trakt' }
        );
        if (decision === 'conflict') review++;
      }
  }
  if (sync.lists) {
    const [connection] = await getDb()
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    if (!connection) throw new Error('Connection not found.');
    const observed = new Set<string>();
    for (const remote of await adapter.lists()) {
      const mapped = Object.entries(
        (connection.settings.exportedLists as Record<string, string>) ?? {}
      ).find(([, id]) => id === String(remote.ids.trakt))?.[0];
      let [local] = await getDb()
        .select()
        .from(lists)
        .where(
          and(
            eq(lists.userId, userId),
            mapped
              ? eq(lists.id, mapped)
              : and(
                  eq(lists.sourceConnectionId, connectionId),
                  eq(lists.externalId, String(remote.ids.trakt))
                )
          )
        );
      if (local?.playlist) continue;
      const initial = !local;
      if (!local)
        [local] = await getDb()
          .insert(lists)
          .values({
            userId,
            name: remote.name,
            description: remote.description,
            source: 'trakt',
            externalId: String(remote.ids.trakt),
            sourceConnectionId: connectionId,
          })
          .returning();
      observed.add(local.id);
      const members: string[] = [];
      for (const record of await adapter.listItems(String(remote.ids.trakt))) {
        const item = await resolveTrakt(record);
        if (item) members.push(item.id);
      }
      const decision = await reconcileProviderList(
        userId,
        connectionId,
        local.id,
        {
          name: remote.name,
          description: (remote.description ?? '')
            .split('\n')
            .filter((line) => !line.startsWith('Coast reference: '))
            .join('\n')
            .trim(),
          items: members,
        },
        initial
      );
      if (decision === 'conflict') review++;
    }
    const previous = await getDb()
      .select()
      .from(syncListValues)
      .where(eq(syncListValues.connectionId, connectionId));
    for (const entry of previous)
      if (!observed.has(entry.listId))
        await reconcileProviderList(userId, connectionId, entry.listId, {
          name: String(entry.remote.name ?? 'Deleted list'),
          description: String(entry.remote.description ?? ''),
          items: [],
          deleted: true,
        });
  }
  await notify({
    userId,
    kind: 'sync',
    title: 'Trakt import complete',
    body: `Imported ${imported} changes${review ? `; ${review} changes need review` : ''}. Coast remains your tracker.`,
    sourceKey: `trakt-import:${connectionId}`,
  });
  return { imported, review };
}
type TraktKind = 'movie' | 'show' | 'season' | 'episode';
type TraktIds = Record<string, string | number>;
const traktPlurals = {
  movie: 'movies',
  show: 'shows',
  season: 'seasons',
  episode: 'episodes',
} as const;
async function exportIdentity(mediaId: string, kind: TraktKind): Promise<TraktIds> {
  const mappings = await getDb()
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, mediaId), eq(externalIds.mediaKind, kind)));
  return Object.fromEntries(
    mappings
      .filter((mapping) => ['trakt', 'tmdb', 'tvdb', 'imdb'].includes(mapping.provider))
      // Hierarchy placeholders such as "123:season:1" are not provider IDs.
      .filter((mapping) =>
        mapping.provider === 'imdb'
          ? mapping.externalId.trim() !== ''
          : /^\d+$/.test(mapping.externalId) &&
            Number.isSafeInteger(Number(mapping.externalId)) &&
            Number(mapping.externalId) > 0
      )
      .map((mapping) => [
        mapping.provider,
        mapping.provider === 'imdb' ? mapping.externalId : Number(mapping.externalId),
      ])
  );
}
/** Read the provider value before overwriting it; imports alone cannot detect edits made since the last sync. */
async function readTraktValue(adapter: TraktAdapter, mediaId: string, category: ValueCategory) {
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
    const [episode] = await getDb().select().from(episodes).where(eq(episodes.mediaId, mediaId));
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
    if (records.length < 100 || category === 'collection') {
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
  const local = await getDb().transaction((tx) => localSyncValue(tx, userId, mediaId, category));
  if (!sameValue(local, desired)) return;
  const remote = await readTraktValue(context.adapter, mediaId, category);
  const decision = await reconcileProviderValue(userId, connectionId, mediaId, category, remote, {
    source: 'trakt',
  });
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
            new Date(event.watched_at).getTime() === new Date(String(record.watched_at)).getTime()
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
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      event: v.picklist(['start', 'pause', 'stop']),
      progress: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
    }),
    input
  );
  const { adapter, sync } = await getTrakt(userId, connectionId);
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
  await adapter.scrobble(data.event, item.kind as 'movie' | 'episode', ids, data.progress);
}
export async function executeJellyfinUserState(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      field: v.picklist(['watched', 'favourite', 'progress']),
      value: v.union([v.boolean(), v.pipe(v.number(), v.minValue(0))]),
      durationSeconds: v.optional(v.number()),
    }),
    input
  );
  const { adapter, connection } = await getJellyfin(userId, connectionId);
  const items = await getDb()
    .selectDistinct({ id: providerItems.externalId })
    .from(availability)
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.connectionId, connectionId),
        eq(availability.mediaId, data.mediaId),
        eq(availability.state, 'available')
      )
    );
  const category = data.field === 'watched' ? 'history' : data.field;
  const desired =
    category === 'progress'
      ? { positionSeconds: Number(data.value), durationSeconds: data.durationSeconds ?? 0 }
      : { value: Boolean(data.value) };
  const current = await getDb().transaction((tx) =>
    localSyncValue(tx, userId, data.mediaId, category)
  );
  if (!sameValue(current, desired)) return;
  for (const item of items) {
    const remote = (await adapter.item(connection.externalUserId!, item.id)).userData;
    if (remote) {
      const decision = await reconcileProviderValue(
        userId,
        connectionId,
        data.mediaId,
        category,
        category === 'progress'
          ? {
              positionSeconds: Math.round(remote.positionSeconds * 1000) / 1000,
              durationSeconds: data.durationSeconds ?? 0,
            }
          : { value: data.field === 'watched' ? remote.played : (remote.favourite ?? false) },
        { source: 'jellyfin' }
      );
      if (decision === 'conflict' || decision === 'remote') return;
    }
    if (data.field === 'progress')
      await adapter.setProgress(connection.externalUserId!, item.id, Number(data.value));
    else
      await adapter.setUserState(
        connection.externalUserId!,
        item.id,
        data.field,
        Boolean(data.value)
      );
  }
  await acknowledgeProviderValue(userId, connectionId, data.mediaId, category, desired);
}

export async function executeJellyfinScrobble(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      sessionId: v.pipe(v.string(), v.uuid()),
      event: v.picklist(['start', 'progress', 'stop']),
      positionSeconds: v.pipe(v.number(), v.minValue(0)),
      paused: v.optional(v.boolean()),
    }),
    input
  );
  const { playbackSessions } = await import('$lib/server/db/schema');
  const [session] = await getDb()
    .select()
    .from(playbackSessions)
    .where(
      and(
        eq(playbackSessions.id, data.sessionId),
        eq(playbackSessions.userId, userId),
        eq(playbackSessions.connectionId, connectionId)
      )
    );
  if (!session) return;
  const [item] = await getDb()
    .select()
    .from(providerItems)
    .where(eq(providerItems.id, session.providerItemId));
  if (!item) return;
  const { adapter } = await getJellyfin(userId, connectionId);
  await adapter.scrobble(data.event, {
    itemId: item.externalId,
    sourceId: session.sourceId,
    playSessionId: session.providerSessionId || undefined,
    positionSeconds: data.positionSeconds,
    paused: data.paused,
    method: session.delivery === 'direct' ? 'DirectPlay' : 'Transcode',
  });
}

export async function queueTraktListChange(userId: string, listId: string) {
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list) throw new Error('List not found.');
  if (list.playlist) return;
  const connections = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(eq(providerConnections.userId, userId), eq(providerConnections.status, 'connected'))
    );
  for (const connection of connections)
    if ((connection.settings.sync as Record<string, boolean> | undefined)?.lists)
      await enqueueAction({
        userId,
        connectionId: connection.id,
        kind: 'trakt.list-export',
        payload: { listId },
        compactionKey: `trakt-list:${listId}`,
      });
}
export async function executeTraktListExport(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const { listId } = v.parse(v.object({ listId: v.pipe(v.string(), v.uuid()) }), input);
  const context = await getTrakt(userId, connectionId);
  if (!context.sync.lists) return;
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list || list.playlist) return;
  const [pending] = await getDb()
    .select()
    .from(syncListValues)
    .where(
      and(
        eq(syncListValues.connectionId, connectionId),
        eq(syncListValues.listId, listId),
        eq(syncListValues.conflict, true)
      )
    );
  if (pending) return;
  const remoteId =
    (list.sourceConnectionId === connectionId ? list.externalId : null) ||
    (context.connection.settings.exportedLists as Record<string, string>)?.[listId];
  if (remoteId) {
    const remote = (await context.adapter.lists()).find(
      (entry) => String(entry.ids.trakt) === remoteId
    );
    const members: string[] = [];
    if (remote)
      for (const record of await context.adapter.listItems(remoteId)) {
        const item = await resolveTrakt(record);
        if (item) members.push(item.id);
      }
    const decision = await reconcileProviderList(userId, connectionId, listId, {
      name: remote?.name ?? list.name,
      description: (remote?.description ?? '')
        .split('\n')
        .filter((line) => !line.startsWith('Coast reference: '))
        .join('\n')
        .trim(),
      items: members,
      ...(!remote ? { deleted: true } : {}),
    });
    if (decision === 'conflict' || decision === 'remote') return;
  }
  if (remoteId)
    await context.adapter.updateList(
      remoteId,
      list.name,
      [list.description, `Coast reference: ${list.id}`].filter(Boolean).join('\n\n')
    );
  await exportTraktListToAdapter(userId, connectionId, input, context);
  const items = await getDb()
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position));
  await acknowledgeProviderList(connectionId, listId, {
    name: list.name,
    description: list.description ?? '',
    items: items.map((item) => item.mediaId),
  });
}
/** The public entrypoint supplies the authenticated account; fixtures use the same reconciliation. */
export async function exportTraktListToAdapter(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>,
  {
    adapter,
    sync,
    connection,
  }: {
    adapter: TraktAdapter;
    sync: SyncPreferences;
    connection: typeof providerConnections.$inferSelect;
  }
) {
  const { listId } = v.parse(v.object({ listId: v.pipe(v.string(), v.uuid()) }), input);
  if (connection.id !== connectionId || connection.userId !== userId)
    throw new PermanentActionError('The Trakt connection does not belong to this account.');
  if (!sync.lists) return;
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list || list.playlist) return;
  const marker = `Coast reference: ${list.id}`;
  let remoteId =
    (list.source === 'trakt' && list.sourceConnectionId === connectionId
      ? list.externalId
      : null) ||
    (connection.settings.exportedLists as Record<string, string> | undefined)?.[list.id];
  if (!remoteId) {
    const existing = (await adapter.lists()).find((remote) =>
      remote.description?.split('\n').includes(marker)
    );
    remoteId = existing
      ? String(existing.ids.trakt)
      : String(
          (
            await adapter.createList(
              list.name,
              [list.description, marker].filter(Boolean).join('\n\n')
            )
          ).ids.trakt
        );
    await getDb()
      .update(providerConnections)
      .set({
        settings: sql`jsonb_set(${providerConnections.settings},'{exportedLists}',coalesce(${providerConnections.settings}->'exportedLists','{}'::jsonb)||jsonb_build_object(${list.id}::text,${remoteId}::text),true)`,
      })
      .where(eq(providerConnections.id, connectionId));
  }
  const local = await getDb()
    .select({ item: media, position: listItems.position })
    .from(listItems)
    .innerJoin(media, eq(media.id, listItems.mediaId))
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position));
  const payload: Record<(typeof traktPlurals)[TraktKind], { ids: TraktIds }[]> = {
    movies: [],
    shows: [],
    seasons: [],
    episodes: [],
  };
  const desired: { kind: TraktKind; ids: TraktIds }[] = [];
  for (const row of local) {
    if (row.item.kind === 'collection') continue;
    const category = traktPlurals[row.item.kind];
    const ids = await exportIdentity(row.item.id, row.item.kind);
    if (row.item.kind === 'season' && !Object.keys(ids).length)
      throw new PermanentActionError('This season has no identity Trakt can match.');
    if (Object.keys(ids).length) {
      payload[category].push({ ids });
      desired.push({ kind: row.item.kind, ids });
    }
  }
  await adapter.writeList(remoteId, payload);
  const remote = await adapter.listItems(remoteId);
  const matches = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    ['trakt', 'tmdb', 'tvdb', 'imdb'].some(
      (key) => a[key] != null && b[key] != null && String(a[key]) === String(b[key])
    );
  const removed = {
    movies: [] as { ids: Record<string, unknown> }[],
    shows: [] as { ids: Record<string, unknown> }[],
    seasons: [] as { ids: Record<string, unknown> }[],
    episodes: [] as { ids: Record<string, unknown> }[],
  };
  for (const record of remote) {
    const entry = traktEntry(record);
    if (
      !entry ||
      desired.some((wanted) => wanted.kind === entry.kind && matches(wanted.ids, entry.item.ids))
    )
      continue;
    removed[traktPlurals[entry.kind]].push({
      ids: entry.item.ids,
    });
  }
  if (Object.values(removed).some((items) => items.length))
    await adapter.writeList(remoteId, removed, true);
  const rank = desired
    .map(
      (wanted) =>
        remote.find((record) => {
          const entry = traktEntry(record);
          return entry && wanted.kind === entry.kind && matches(wanted.ids, entry.item.ids);
        })?.id
    )
    .filter((id): id is number => id !== undefined);
  if (rank.length) await adapter.reorderList(remoteId, rank);
}

export async function deleteListWithExports(userId: string, listId: string) {
  return getDb().transaction(async (tx) => {
    const [list] = await tx
      .select()
      .from(lists)
      .where(
        and(eq(lists.userId, userId), eq(lists.id, v.parse(v.pipe(v.string(), v.uuid()), listId)))
      );
    if (!list) throw new Error('List not found.');
    if (list.playlist) {
      await tx.delete(lists).where(eq(lists.id, list.id));
      return { deleted: true };
    }
    const connections = await tx
      .select()
      .from(providerConnections)
      .where(
        and(eq(providerConnections.userId, userId), eq(providerConnections.status, 'connected'))
      )
      .orderBy(asc(providerConnections.id));
    for (const connection of connections) {
      if (!(connection.settings.sync as Record<string, boolean> | undefined)?.lists) continue;
      const externalId =
        list.source === 'trakt' && list.sourceConnectionId === connection.id
          ? list.externalId
          : (connection.settings.exportedLists as Record<string, string> | undefined)?.[list.id];
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${connection.id}`},0))`
      );
      await tx
        .update(outboxActions)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(outboxActions.connectionId, connection.id),
            eq(outboxActions.kind, 'trakt.list-export'),
            eq(outboxActions.state, 'pending'),
            sql`${outboxActions.payload}->>'listId'=${list.id}`
          )
        );
      // A running create can finish after local deletion; the tombstone resolves its stable marker at dispatch.
      await tx.insert(outboxActions).values({
        userId,
        connectionId: connection.id,
        kind: 'trakt.list-delete',
        payload: { listId: list.id, ...(externalId ? { externalId } : {}) },
        createdAt: sql`clock_timestamp()`,
      });
    }
    await tx.delete(lists).where(eq(lists.id, list.id));
    return { deleted: true };
  });
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
  const mappings = await getDb().select().from(externalIds).where(eq(externalIds.mediaId, item.id));
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
