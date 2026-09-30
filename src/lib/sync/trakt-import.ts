import { reconcileProviderList } from '$lib/sync/list-values';
import { reconcileProviderValue } from '$lib/sync/values';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  externalIds,
  media,
  seasons,
  lists,
  providerConnections,
  removedTrackingSources,
  syncValues,
  syncListValues,
} from '$lib/server/db/schema';
import { notify } from '$lib/server/notifications';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import { ingestMetadata, importTmdb, getTmdb } from '$lib/catalogue/service';
import { trackInTransaction } from '$lib/core/tracking/service';
import type { Metadata, SyncCategory, SyncPreferences } from '$lib/providers/contracts';
import type { TraktRecord, TraktAdapter } from '$lib/providers/trakt/adapter.server';
import { traktEntry } from '$lib/sync/trakt-identity';

export async function resolveTrakt(
  record: TraktRecord
): Promise<typeof media.$inferSelect | null> {
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
            positionSeconds:
              Math.round(((duration * (record.progress || 0)) / 100) * 1000) / 1000,
            durationSeconds: duration,
          }
        : { value: true };
    const decision = await reconcileProviderValue(
      userId,
      connectionId,
      item.id,
      category,
      remote,
      {
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
      }
    );
    if (decision === 'conflict') review++;
    else if (decision === 'remote') imported++;
  };
  for (const category of [
    'history',
    'progress',
    'collection',
    'ratings',
    'watchlist',
  ] as const) {
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
              ? {
                  positionSeconds: 0,
                  durationSeconds: Number(entry.remote.durationSeconds) || 0,
                }
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
      .where(
        and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))
      );
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
