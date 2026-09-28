import type { SequenceSource } from '../../media/sequence';
import { sequenceEntries, nextSequenceEntry, type SequenceEntry } from '../../core/lists/sequence';
import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch';
import { lifecycle } from '$lib/media/model';
import { tmdbArtworkUrl } from '$lib/providers/tmdb/artwork.server';
import type { CastMember } from '$lib/providers/contracts';
import { artworkKeys, type ArtworkImages } from '$lib/artwork';
import { and, asc, desc, eq, getTableColumns, ilike, inArray, or, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { getConfig } from '../config';
import { resolveMetadata } from '../../catalogue/metadata/resolve';
import { AppError } from '../security/errors';
import type { MediaView } from '../../ui/types';

const uuidSchema = v.pipe(v.string(), v.uuid());
const viewOptionsSchema = v.object({
  ids: v.optional(v.pipe(v.array(uuidSchema), v.maxLength(10000))),
  query: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))),
  kind: v.optional(v.picklist(['movie', 'show', 'season', 'episode', 'collection'])),
  availableFirst: v.optional(v.boolean(), false),
});
type CollectionDescendant = {
  rootId: string;
  mediaId: string;
  kind: s.MediaKind;
  runtimeMinutes: number | null;
  positionPath: number[];
};
function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = grouped.get(id);
    if (group) group.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}
async function collectionDescendants(ids: string[]): Promise<CollectionDescendant[]> {
  if (!ids.length) return [];
  // The path check bounds malformed cyclic relationships; only selected roots are traversed.
  return Array.from(
    await getDb().execute<CollectionDescendant>(sql`
    with recursive descendants(root_id, media_id, path, position_path) as (
      select parent_id, child_id, array[parent_id, child_id], array[position] from media_relationships
      where ${inArray(s.mediaRelationships.parentId, ids)} and kind in ('collection', 'franchise')
      union all
      select d.root_id, r.child_id, d.path || r.child_id, d.position_path || r.position from descendants d
      join media_relationships r on r.parent_id = d.media_id
      where r.kind in ('collection', 'franchise') and not r.child_id = any(d.path)
    )
    select distinct on (d.root_id, d.media_id) d.root_id as "rootId", d.media_id as "mediaId", m.kind, m.runtime_minutes as "runtimeMinutes", d.position_path as "positionPath"
    from descendants d join media m on m.id = d.media_id
    order by d.root_id, d.media_id, d.position_path
  `)
  ) as CollectionDescendant[];
}
export function permittedAvailability(userId: string) {
  return and(
    eq(s.availability.userId, userId),
    eq(s.providerConnections.userId, userId),
    eq(s.availability.state, 'available'),
    eq(s.providerConnections.status, 'connected'),
    eq(s.providerInstances.enabled, true)
  );
}

export function permittedMediaSources(userId: string, source = 'all') {
  // Expand permitted sources once, rather than searching a user's entire episode
  // library again for every candidate title in the count and page queries.
  return sql`select related.media_id, p.name from availability a
    join provider_connections c on c.id = a.connection_id
    join provider_instances p on p.id = c.instance_id
    left join episodes e on e.media_id = a.media_id
    cross join lateral (values (a.media_id), (e.show_id), (e.season_id)) related(media_id)
    where a.user_id = ${userId} and c.user_id = ${userId}
      and a.state = 'available' and c.status = 'connected' and p.enabled
      and ${source === 'all' ? sql`true` : sql`p.id = ${source}`}
      and related.media_id is not null`;
}
export function hasPermittedMediaSource(userId: string, source = 'all') {
  return sql`${s.media.id} in (select permitted.media_id from (${permittedMediaSources(userId, source)}) permitted)`;
}

export async function mediaViews(
  userId: string,
  rawOptions: {
    ids?: string[];
    query?: string;
    limit?: number;
    kind?: string;
    availableFirst?: boolean;
  } = {},
  viewerId = userId
): Promise<MediaView[]> {
  v.parse(uuidSchema, userId);
  const options = v.parse(viewOptionsSchema, rawOptions);
  if (options.ids?.length === 0) return [];
  const db = getDb();
  const pattern = options.query
    ? `%${options.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    : undefined;
  const matches = pattern
    ? or(
        ilike(s.media.title, pattern),
        ilike(s.media.originalTitle, pattern),
        sql`exists (select 1 from metadata_snapshots ms where ms.media_id = ${s.media.id} and (ms.title ilike ${pattern} or ms.original_title ilike ${pattern}))`,
        sql`exists (select 1 from metadata_overrides mo where mo.media_id = ${s.media.id} and (mo.title ilike ${pattern} or mo.original_title ilike ${pattern}))`,
        sql`exists (select 1 from user_metadata_preferences mp where mp.media_id = ${s.media.id} and mp.user_id = ${userId} and mp.title ilike ${pattern})`
      )
    : undefined;
  const rows = await db
    .select()
    .from(s.media)
    .where(
      and(
        options.ids ? inArray(s.media.id, options.ids) : undefined,
        options.kind
          ? eq(s.media.kind, options.kind)
          : options.ids
            ? undefined
            : inArray(s.media.kind, ['movie', 'show', 'collection']),
        matches
      )
    )
    .orderBy(
      ...(options.availableFirst ? [desc(hasPermittedMediaSource(viewerId))] : []),
      desc(s.media.updatedAt),
      asc(s.media.id)
    )
    .limit(options.limit ?? 150);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const queued = new Set(
    (
      await db
        .select({ id: s.upNext.mediaId })
        .from(s.upNext)
        .where(and(eq(s.upNext.userId, userId), inArray(s.upNext.mediaId, ids)))
    ).map((row) => row.id)
  );
  const descendants = await collectionDescendants(
    rows.filter((row) => row.kind === 'collection').map((row) => row.id)
  );
  const boundaries = new Map(
    (
      await db
        .select({
          id: s.media.id,
          startedAt: rewatchBoundary(userId, sql`${s.media.id}`),
        })
        .from(s.media)
        .where(inArray(s.media.id, ids))
    ).map((row) => [row.id, row.startedAt])
  );
  const hierarchyIds = [...new Set([...ids, ...descendants.map((row) => row.mediaId)])];
  // Collection availability includes descendant episodes; progress is resolved by the sequence reader.
  const episodeParents = descendants
    .filter((row) => row.kind === 'show' || row.kind === 'season')
    .map((row) => row.mediaId);
  const episodeRows = await db
    .select()
    .from(s.episodes)
    .where(
      or(
        inArray(s.episodes.mediaId, hierarchyIds),
        episodeParents.length ? inArray(s.episodes.showId, episodeParents) : undefined,
        episodeParents.length ? inArray(s.episodes.seasonId, episodeParents) : undefined
      )
    );
  const seasonRows = await db.select().from(s.seasons).where(inArray(s.seasons.mediaId, ids));
  const seasonById = new Map(seasonRows.map((season) => [season.mediaId, season]));
  const scopeIds = [...new Set([...hierarchyIds, ...episodeRows.map((row) => row.mediaId)])];
  const artworkIds = [
    ...new Set([
      ...ids,
      ...episodeRows.flatMap((episode) => [
        episode.showId,
        ...(episode.seasonId ? [episode.seasonId] : []),
      ]),
      ...seasonRows.map((season) => season.showId),
    ]),
  ];
  const { raw: _rawSnapshot, ...snapshotColumns } = getTableColumns(s.metadataSnapshots);
  const [
    states,
    scores,
    available,
    snapshots,
    overrides,
    locks,
    preferences,
    userRows,
    config,
    artworkRows,
    tmdbIdentities,
    artworkMedia,
  ] = await Promise.all([
    db
      .select({
        ...getTableColumns(s.trackingState),
        watched: rewatchFields(userId, sql`${s.trackingState.mediaId}`).watched,
        positionSeconds: rewatchFields(userId, sql`${s.trackingState.mediaId}`).progress,
      })
      .from(s.trackingState)
      .where(and(eq(s.trackingState.userId, userId), inArray(s.trackingState.mediaId, artworkIds))),
    db
      .select()
      .from(s.ratings)
      .where(and(eq(s.ratings.userId, userId), inArray(s.ratings.mediaId, ids))),
    db
      .execute<{ mediaId: string; name: string }>(
        sql`
        select distinct permitted.media_id as "mediaId", permitted.name
        from (${permittedMediaSources(viewerId)}) permitted
        where ${inArray(sql`permitted.media_id`, scopeIds)}
      `
      )
      .then((rows) => Array.from(rows)),
    db
      .select({
        ...snapshotColumns,
        artwork: sql<ArtworkImages | null>`${s.metadataSnapshots.raw}->'artwork'`,
      })
      .from(s.metadataSnapshots)
      .where(inArray(s.metadataSnapshots.mediaId, artworkIds)),
    db.select().from(s.metadataOverrides).where(inArray(s.metadataOverrides.mediaId, artworkIds)),
    db.select().from(s.metadataLocks).where(inArray(s.metadataLocks.mediaId, artworkIds)),
    db
      .select()
      .from(s.userMetadataPreferences)
      .where(
        and(
          eq(s.userMetadataPreferences.userId, userId),
          inArray(s.userMetadataPreferences.mediaId, artworkIds)
        )
      ),
    db.select({ settings: s.users.settings }).from(s.users).where(eq(s.users.id, userId)),
    getConfig(),
    db
      .select({
        mediaId: s.providerItems.mediaId,
        artwork: sql<ArtworkImages | null>`${s.providerItems.snapshot}->'artwork'`,
      })
      .from(s.providerItems)
      .innerJoin(s.availability, eq(s.availability.providerItemId, s.providerItems.id))
      .innerJoin(s.providerConnections, eq(s.providerConnections.id, s.availability.connectionId))
      .innerJoin(s.providerInstances, eq(s.providerInstances.id, s.providerItems.instanceId))
      .where(and(inArray(s.providerItems.mediaId, artworkIds), permittedAvailability(viewerId)))
      .orderBy(desc(s.providerItems.lastSeenAt), asc(s.providerItems.id)),
    db
      .select({ mediaId: s.externalIds.mediaId })
      .from(s.externalIds)
      .where(
        and(
          eq(s.externalIds.provider, 'tmdb'),
          inArray(s.externalIds.mediaId, [
            ...ids,
            ...episodeRows.map((episode) => episode.showId),
            ...seasonRows.map((season) => season.showId),
          ])
        )
      ),
    db.select().from(s.media).where(inArray(s.media.id, artworkIds)),
  ]);
  const tmdbIds = new Set(tmdbIdentities.map((identity) => identity.mediaId));
  const settings = userRows[0]?.settings ?? {};
  const stateById = new Map(states.map((row) => [row.mediaId, row]));
  const ratingById = new Map(scores.map((row) => [row.mediaId, row.value]));
  const snapshotById = groupBy(snapshots, (row) => row.mediaId);
  const overrideById = new Map(overrides.map((row) => [row.mediaId, row]));
  const lockById = groupBy(locks, (row) => row.mediaId);
  const preferenceById = new Map(preferences.map((row) => [row.mediaId, row]));
  const availableById = groupBy(available, (row) => row.mediaId);
  const episodeById = new Map(episodeRows.map((row) => [row.mediaId, row]));
  const episodesByShow = groupBy(episodeRows, (row) => row.showId);
  const episodesBySeason = groupBy(
    episodeRows.filter((row) => row.seasonId),
    (row) => row.seasonId!
  );
  const descendantsByRoot = groupBy(descendants, (row) => row.rootId);
  const artworkById = new Map<string, ArtworkImages>();
  for (const row of artworkRows) {
    if (row.mediaId && row.artwork)
      artworkById.set(row.mediaId, {
        ...row.artwork,
        ...artworkById.get(row.mediaId),
      });
  }
  const metadataById = new Map(artworkMedia.map((row) => [row.id, resolveArtworkMetadata(row)]));
  function resolveArtworkMetadata(row: typeof s.media.$inferSelect) {
    return resolveMetadata({
      fallback: row,
      snapshots: snapshotById.get(row.id),
      override: overrideById.get(row.id),
      locks: lockById.get(row.id)?.map((lock) => lock.field),
      user: preferenceById.get(row.id),
      policy: config.metadataSource === 'tmdb-only' ? 'tmdb-only' : 'local-first',
      preferOriginalTitle: settings.originalTitles,
      region: settings.region,
    }).values;
  }
  const views = rows.map((row): MediaView => {
    const state = stateById.get(row.id);
    const metadata = metadataById.get(row.id)!;
    const episode = episodeById.get(row.id);
    const availableIds = new Set([row.id]);
    const includeEpisodes = (parentId: string) => {
      for (const child of [
        ...(episodesByShow.get(parentId) ?? []),
        ...(episodesBySeason.get(parentId) ?? []),
      ]) {
        availableIds.add(child.mediaId);
      }
    };
    includeEpisodes(row.id);
    for (const child of descendantsByRoot.get(row.id) ?? []) {
      availableIds.add(child.mediaId);
      includeEpisodes(child.mediaId);
    }
    const sources = new Set<string>();
    for (const id of availableIds)
      for (const source of availableById.get(id) ?? []) sources.add(source.name);
    const progress = state?.positionSeconds ?? 0;
    const duration = state?.durationSeconds ?? 0;
    const watched = state?.watched ?? false;
    const parentId = episode?.showId ?? seasonById.get(row.id)?.showId;
    const matched = tmdbIds.has(row.id) || (parentId && tmdbIds.has(parentId));
    const fallback = (type: string) =>
      matched ? `/api/v1/artwork/fallback/${row.id}/${type}` : undefined;
    const artwork: ArtworkImages = {};
    const artworkSources: NonNullable<MediaView['artworkSources']> = {};
    const lineage = [row.id, episode?.seasonId, parentId].filter((id): id is string => Boolean(id));
    for (const id of lineage) {
      const tmdbImages: ArtworkImages = {};
      for (const snapshot of (snapshotById.get(id) ?? [])
        .filter((snapshot) => snapshot.provider === 'tmdb')
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
        for (const key of artworkKeys)
          tmdbImages[key] ||=
            tmdbArtworkUrl(snapshot.artwork?.[key], config.cacheTmdbArtwork) || undefined;
      }
      const inherited =
        config.metadataSource === 'tmdb-only'
          ? { ...tmdbImages }
          : { ...tmdbImages, ...artworkById.get(id) };
      const values = metadataById.get(id);
      inherited.primary =
        tmdbArtworkUrl(values?.posterPath, config.cacheTmdbArtwork) || inherited.primary;
      inherited.backdrop =
        tmdbArtworkUrl(values?.backdropPath, config.cacheTmdbArtwork) || inherited.backdrop;
      // Episode Primary images are stills, unlike season/show posters.
      if (row.kind === 'episode' && id === row.id)
        inherited.thumb ||= inherited.primary || inherited.screenshot || inherited.backdrop;
      const level = id === row.id ? row.kind : id === episode?.seasonId ? 'season' : 'show';
      if (level === 'episode' || level === 'season' || level === 'show')
        artworkSources[level] = { ...inherited };
      for (const key of artworkKeys) artwork[key] ||= inherited[key];
    }
    artwork.primary ||= fallback('primary');
    artwork.backdrop ||= fallback('backdrop');
    artwork.logo ||= fallback('logo');
    if (row.kind === 'episode')
      artwork.thumb ||= artwork.backdrop || artwork.primary || fallback('thumb');
    return {
      id: row.id,
      kind: row.kind,
      title: metadata.title ?? row.title,
      originalTitle: metadata.originalTitle,
      overview: metadata.overview,
      poster: tmdbArtworkUrl(metadata.posterPath, config.cacheTmdbArtwork) || artwork.primary,
      backdrop: tmdbArtworkUrl(metadata.backdropPath, config.cacheTmdbArtwork) || artwork.backdrop,
      logo: artwork.logo,
      artwork: Object.values(artwork).some(Boolean) ? artwork : undefined,
      artworkSources: Object.keys(artworkSources).length ? artworkSources : undefined,
      year: metadata.releaseDate ? Number(metadata.releaseDate.slice(0, 4)) : row.year,
      runtimeMinutes: metadata.runtimeMinutes,
      genres: metadata.genres ?? [],
      certification: metadata.certificate,
      category: 'screen',
      canOpen: sources.size > 0,
      status: lifecycle({
        completed: watched,
        dropped: state?.dropped ?? false,
        planned: state?.watchlist ?? false,
        progress: { unit: 'seconds', value: progress },
      }),
      trackingProgress: {
        unit: 'seconds',
        value: progress,
        ...(duration > 0 ? { total: duration } : {}),
      },
      available: sources.size > 0,
      availableSources: [...sources],
      progress,
      duration,
      watched,
      playCount: state?.playCount ?? 0,
      queued: queued.has(row.id),
      watchlist: state?.watchlist ?? false,
      favourite: state?.favourite ?? false,
      collected: state?.collected ?? false,
      dropped: state?.dropped ?? false,
      trackingParents: [episode?.seasonId, parentId]
        .filter((id): id is string => Boolean(id))
        .flatMap((id) => {
          const parent = artworkMedia.find((media) => media.id === id);
          return parent
            ? [
                {
                  id,
                  kind: parent.kind,
                  title: String(metadataById.get(id)?.title ?? parent.title),
                  dropped: stateById.get(id)?.dropped ?? false,
                },
              ]
            : [];
        }),
      rewatchStartedAt: boundaries.get(row.id)
        ? new Date(boundaries.get(row.id)!).toISOString()
        : null,
      rating: ratingById.get(row.id) ?? null,
      completedEpisodes: state?.completedEpisodes ?? 0,
      totalEpisodes: state?.totalEpisodes ?? 0,
      seasonNumber: episode?.seasonNumber ?? seasonById.get(row.id)?.seasonNumber,
      episodeNumber: episode?.episodeNumber,
      showId: episode?.showId ?? seasonById.get(row.id)?.showId,
    };
  });
  for (const item of views.filter((item) => item.kind === 'collection')) {
    const entries = await sequenceEntries(userId, { kind: 'collection', id: item.id });
    item.completedEpisodes = entries.filter((entry) => entry.watched).length;
    item.totalEpisodes = entries.length;
    item.watched = entries.length > 0 && entries.every((entry) => entry.watched);
    item.duration = entries.reduce((sum, entry) => sum + entry.duration, 0);
    item.progress = entries.reduce(
      (sum, entry) => sum + (entry.watched ? entry.duration : entry.progress),
      0
    );
    item.trackingProgress = { unit: 'seconds', value: item.progress, total: item.duration };
    item.status = item.dropped
      ? 'dropped'
      : item.watched
        ? 'completed'
        : item.rewatchStartedAt || item.progress > 0
          ? 'in-progress'
          : null;
  }
  const rewatchGroups = views.filter(
    (item) => item.rewatchStartedAt && ['show', 'season'].includes(item.kind)
  );
  if (rewatchGroups.length) {
    const effective = rewatchFields(userId, sql`e.media_id`, sql`child`);
    const counts = await db.execute<{ id: string; total: number; completed: number }>(sql`
      select parent.id, count(*)::int total, count(*) filter(where ${effective.watched})::int completed
      from media parent join episodes e on (e.show_id=parent.id or e.season_id=parent.id)
      left join tracking_state child on child.media_id=e.media_id and child.user_id=${userId}
      where parent.id in (${sql.join(
        rewatchGroups.map((item) => sql`${item.id}::uuid`),
        sql`,`
      )})
        and not e.is_special group by parent.id`);
    for (const item of rewatchGroups) {
      const count = counts.find((row) => row.id === item.id);
      item.completedEpisodes = count?.completed ?? 0;
      item.totalEpisodes = count?.total ?? 0;
      item.watched = !!count?.total && count.completed === count.total;
      item.progress = count?.completed ?? 0;
      item.duration = count?.total ?? 0;
      item.trackingProgress = { unit: 'episodes', value: item.progress, total: item.duration };
      item.status = item.dropped ? 'dropped' : item.watched ? 'completed' : 'in-progress';
    }
  }
  return options.query ? views.sort((a, b) => Number(b.available) - Number(a.available)) : views;
}

/** Explicit detail/list membership is complete; the 500-row bound only limits each query batch. */
export async function mediaViewsForIds(
  userId: string,
  ids: string[],
  viewerId = userId
): Promise<MediaView[]> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += 500)
    batches.push(unique.slice(offset, offset + 500));
  return (
    await Promise.all(
      batches.map((batch) => mediaViews(userId, { ids: batch, limit: 500 }, viewerId))
    )
  ).flat();
}

export function applySequenceEntry(
  item: MediaView,
  entry: SequenceEntry,
  source: SequenceSource
): MediaView {
  return {
    ...item,
    entryId: entry.entryId,
    sequence: { ...source, entryId: entry.entryId },
    watched: entry.watched,
    dropped: entry.dropped,
    status: entry.dropped
      ? 'dropped'
      : entry.watched
        ? 'completed'
        : entry.progress > 0 || entry.startedAt
          ? 'in-progress'
          : null,
    progress: entry.progress,
    duration: entry.duration,
    rewatchStartedAt: entry.startedAt,
    trackingProgress: { unit: 'seconds', value: entry.progress, total: entry.duration },
  };
}
export async function sequenceNextView(
  userId: string,
  source: SequenceSource,
  afterEntryId?: string,
  fromEntryId?: string
) {
  const entries = await sequenceEntries(userId, source);
  const first = fromEntryId
    ? entries.findIndex(
        (entry) => entry.entryId === fromEntryId || entry.entryId.startsWith(fromEntryId + '/')
      )
    : 0;
  if (first < 0) throw new AppError(409, 'The sequence changed. Open it again to continue.');
  const selected = fromEntryId
    ? entries.filter(
        (entry) => entry.entryId === fromEntryId || entry.entryId.startsWith(fromEntryId + '/')
      )
    : [];
  const next =
    fromEntryId && !afterEntryId
      ? entries[first].entryId === fromEntryId
        ? entries[first]
        : (nextSequenceEntry(selected) ?? selected[0])
      : nextSequenceEntry(entries, afterEntryId);
  if (!next) return null;
  const [item] = await mediaViews(userId, { ids: [next.mediaId] });
  return item ? applySequenceEntry(item, next, source) : null;
}

export async function nextPlayable(userId: string, item: MediaView): Promise<MediaView | null> {
  if (item.kind === 'movie' || item.kind === 'episode') return item.available ? item : null;
  if (item.kind === 'collection')
    return sequenceNextView(userId, { kind: 'collection', id: item.id });
  const children = await getDb()
    .select({ id: s.episodes.mediaId })
    .from(s.episodes)
    .where(
      and(
        or(eq(s.episodes.showId, item.id), eq(s.episodes.seasonId, item.id)),
        eq(s.episodes.isSpecial, false)
      )
    )
    .orderBy(asc(s.episodes.seasonNumber), asc(s.episodes.episodeNumber));
  const ids = children.map((child) => child.id);
  if (!ids.length) return null;
  const itemOrder = sql`case ${s.media.id} ${sql.join(
    ids.map((id, index) => sql`when ${id} then ${index}`),
    sql` `
  )} else ${ids.length} end`;
  const [candidate] = await getDb()
    .select({ id: s.media.id })
    .from(s.media)
    .leftJoin(
      s.trackingState,
      and(eq(s.trackingState.mediaId, s.media.id), eq(s.trackingState.userId, userId))
    )
    .leftJoin(s.episodes, eq(s.episodes.mediaId, s.media.id))
    .where(
      and(
        inArray(s.media.id, ids),
        sql`exists (select 1 from availability a join provider_connections c on c.id = a.connection_id join provider_instances p on p.id = c.instance_id where a.media_id = ${s.media.id} and a.user_id = ${userId} and c.user_id = ${userId} and a.state = 'available' and c.status = 'connected' and p.enabled)`
      )
    )
    .orderBy(
      sql`case when not (${rewatchFields(userId, sql`${s.media.id}`).watched}) and (${rewatchFields(userId, sql`${s.media.id}`).progress}) > 0 then 0 when not (${rewatchFields(userId, sql`${s.media.id}`).watched}) then 1 else 2 end`,
      itemOrder,
      asc(s.media.id)
    )
    .limit(1);
  if (!candidate) return null;
  return (await mediaViews(userId, { ids: [candidate.id] }))[0] ?? null;
}

export async function detailsData(userId: string, id: string) {
  v.parse(uuidSchema, id);
  const [item] = await mediaViews(userId, { ids: [id] });
  if (!item) throw new AppError(404, 'This title was not found.');
  const db = getDb();
  const contextId = item.showId ?? id;
  const [episodeIds, seasonRows, relationships, availability, history, ids] = await Promise.all([
    db
      .select()
      .from(s.episodes)
      .where(item.kind === 'season' ? eq(s.episodes.seasonId, id) : sql`false`)
      .orderBy(asc(s.episodes.seasonNumber), asc(s.episodes.episodeNumber)),
    db
      .select()
      .from(s.seasons)
      .where(or(eq(s.seasons.showId, id), eq(s.seasons.mediaId, id)))
      .orderBy(asc(s.seasons.seasonNumber)),
    db
      .select()
      .from(s.mediaRelationships)
      .where(
        or(
          eq(s.mediaRelationships.parentId, contextId),
          eq(s.mediaRelationships.childId, contextId)
        )
      )
      .orderBy(asc(s.mediaRelationships.position)),
    db
      .select({
        id: s.availability.id,
        sourceId: s.availability.sourceId,
        edition: s.availability.edition,
        width: s.availability.width,
        height: s.availability.height,
        connectionId: s.availability.connectionId,
        provider: s.providerInstances.name,
      })
      .from(s.availability)
      .innerJoin(s.providerConnections, eq(s.availability.connectionId, s.providerConnections.id))
      .innerJoin(s.providerInstances, eq(s.providerConnections.instanceId, s.providerInstances.id))
      .where(and(permittedAvailability(userId), eq(s.availability.mediaId, id))),
    db
      .select()
      .from(s.trackingEvents)
      .where(and(eq(s.trackingEvents.userId, userId), eq(s.trackingEvents.mediaId, id)))
      .orderBy(desc(s.trackingEvents.occurredAt))
      .limit(20),
    db.select().from(s.externalIds).where(eq(s.externalIds.mediaId, id)),
  ]);
  const [episodeParent] =
    item.kind === 'episode'
      ? await db.select().from(s.episodes).where(eq(s.episodes.mediaId, id))
      : [];
  const parents = await mediaViewsForIds(
    userId,
    [item.showId, episodeParent?.seasonId].filter((id): id is string => Boolean(id))
  );
  const childViews = await mediaViewsForIds(userId, [
    ...episodeIds.map((episode) => episode.mediaId),
    ...seasonRows.map((season) => season.mediaId),
  ]);
  const childById = new Map(childViews.map((child) => [child.id, child]));
  const episodes = episodeIds.flatMap((episode) =>
    childById.get(episode.mediaId) ? [childById.get(episode.mediaId)!] : []
  );
  const [next, related] = await Promise.all([
    nextPlayable(userId, item),
    mediaViewsForIds(
      userId,
      relationships.map((relationship) =>
        relationship.parentId === contextId ? relationship.childId : relationship.parentId
      )
    ),
  ]);
  const collectionIds = new Set(
    relationships
      .filter((relationship) => relationship.childId === id && relationship.kind === 'collection')
      .map((relationship) => relationship.parentId)
  );
  const parentCollections = related.filter(
    (relatedItem) => relatedItem.kind === 'collection' && collectionIds.has(relatedItem.id)
  );
  const collections = await Promise.all(
    parentCollections.map(async (collection) => {
      const source = { kind: 'collection' as const, id: collection.id };
      const entries = await sequenceEntries(userId, source);
      const members = new Map(
        (
          await mediaViewsForIds(
            userId,
            entries.map((entry) => entry.mediaId)
          )
        ).map((item) => [item.id, item])
      );
      return {
        item: collection,
        id: collection.id,
        title: collection.title,
        items: entries.flatMap((entry) => {
          const item = members.get(entry.mediaId);
          return item ? [applySequenceEntry(item, entry, source)] : [];
        }),
      };
    })
  );
  let members: MediaView[] = [];
  if (item.kind === 'collection') {
    const source = { kind: 'collection' as const, id };
    const entries = await sequenceEntries(userId, source);
    const views = new Map(
      (
        await mediaViewsForIds(
          userId,
          entries.map((e) => e.mediaId)
        )
      ).map((m) => [m.id, m])
    );
    members = entries.flatMap((entry) => {
      const child = views.get(entry.mediaId);
      return child ? [applySequenceEntry(child, entry, source)] : [];
    });
  }
  const [castSnapshot] = await db
    .select({ cast: sql<CastMember[] | null>`${s.metadataSnapshots.raw}->'cast'` })
    .from(s.metadataSnapshots)
    .where(
      and(
        inArray(s.metadataSnapshots.mediaId, [id, contextId]),
        eq(s.metadataSnapshots.provider, 'tmdb'),
        sql`jsonb_array_length(coalesce(${s.metadataSnapshots.raw}->'cast','[]'::jsonb)) > 0`
      )
    )
    .orderBy(
      sql`case when ${s.metadataSnapshots.mediaId} = ${id} then 0 else 1 end`,
      desc(s.metadataSnapshots.updatedAt)
    )
    .limit(1);
  const cacheArtwork = (await getConfig()).cacheTmdbArtwork;
  const cast = (castSnapshot?.cast ?? []).map((person) => ({
    ...person,
    portrait: tmdbArtworkUrl(person.portrait, cacheArtwork) ?? undefined,
  }));
  return {
    item: { ...item, tmdbId: ids.find((row) => row.provider === 'tmdb')?.externalId },
    episodes,
    members,
    parents: parents.sort((a, b) => Number(b.kind === 'show') - Number(a.kind === 'show')),
    cast,
    seasons: seasonRows.map((season) => ({
      ...season,
      title: childById.get(season.mediaId)?.title,
      item: childById.get(season.mediaId),
    })),
    next,
    related,
    collections,
    availability,
    history,
  };
}
