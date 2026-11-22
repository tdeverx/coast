import { and, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { episodes, externalIds, seasons } from '#lib/server/db/schema.js';
import { providerCache } from '#lib/server/utils/provider-cache.js';
import { providerSingleFlight } from '#lib/server/utils/provider-single-flight.js';
import { mapConcurrent } from '#lib/server/utils/async.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { logDiagnostic } from '#lib/server/diagnostics/index.js';
import type { Metadata } from '#lib/providers/contracts.js';
import type { TmdbAdapter } from '#lib/providers/tmdb/adapter.server.js';
import { ingestMetadata, type CatalogueTransaction } from './service.server.js';

export const anthologyTmdb = 'tmdb:anthology';
export const anthologyTrakt = 'trakt:anthology';
export function isAnthologyRoot(mediaId: string | SQLWrapper) {
  return sql`exists (select 1 from seasons season join external_ids source
    on source.media_id=season.media_id and source.provider=${anthologyTmdb} where season.show_id=${mediaId})`;
}
const maxStories = 12;
const maxEpisodesPerStory = 64;
const maxGroupEpisodes = 128;

type Story = { title: Metadata; season: Metadata; episodes: readonly Metadata[] };
type LegacyRow = { id: string; aliases: string[]; parent?: string; direct?: boolean; ambiguous?: boolean; watchedIds?: string[] };
type Placement = { story: Story; seasonId?: string; episodes: Map<string, string> };

function singleSeason(title: Metadata) {
  const regular = title.children?.filter(season => season.seasonNumber !== 0);
  return regular?.length === 1 && regular[0].seasonNumber === 1;
}

export async function anthologySource(seasonId: string) {
  const [mapping] = await getDb().select({ id: externalIds.externalId }).from(externalIds)
    .where(and(eq(externalIds.mediaId, seasonId), eq(externalIds.provider, anthologyTmdb), eq(externalIds.mediaKind, 'season')));
  return mapping?.id;
}

export async function anthologySeason(tmdbId: string) {
  const [season] = await getDb().select().from(seasons).innerJoin(externalIds, eq(seasons.mediaId, externalIds.mediaId))
    .where(and(eq(externalIds.provider, anthologyTmdb), eq(externalIds.externalId, tmdbId), eq(externalIds.mediaKind, 'season')));
  return season?.seasons;
}

const grouping = providerSingleFlight<boolean>('tmdb-anthology');
const unresolved = providerCache<false>(128, 5 * 60_000);

/** Only hydrate catalogue rows with competing TMDB IDs on a shared series. */
export async function reconcileAnthology(adapter: TmdbAdapter, showId: string, current: Metadata): Promise<boolean | null> {
  if (!current.externalIds?.tvdb)
    return await anthologySeason(current.externalId) ? true : null;
  const sources = await getDb().execute<{ id: string; mapped: boolean; unclaimedHierarchy: boolean }>(sql`
    with hierarchy as (
      select count(*)>1 and bool_or(not exists(
        select 1 from external_ids owner where owner.media_id=season.media_id and owner.provider=${anthologyTmdb}
      )) as unclaimed from seasons season where season.show_id=${showId} and season.season_number>0
    )
    select root.external_id as id, grouped.id is not null as mapped, hierarchy.unclaimed as "unclaimedHierarchy"
    from external_ids root left join external_ids grouped
      on (grouped.provider,grouped.external_id,grouped.media_kind)=(${anthologyTmdb},root.external_id,'season')
    cross join hierarchy
    where root.media_id=${showId} and root.provider='tmdb' and root.media_kind='show'
    order by root.external_id limit ${maxStories + 1}`);
  const adopt = !!sources[0]?.unclaimedHierarchy && singleSeason(current) && !sources.some(source => source.id === current.externalId && source.mapped);
  if (sources.length < 2 && !adopt) return sources[0]?.mapped ? true : null;
  if (sources.every(source => source.mapped)) return true;
  // A shared series ID is insufficient to match children by number.
  if (sources.length > maxStories) return false;
  const key = JSON.stringify([adapter.cacheScope, showId, adopt ? current.externalId : null, sources.map(source => source.id)]);
  if (unresolved.peek(key) === false) return false;
  return grouping(key, async () => {
    let stories: Story[];
    try {
      const nativeSeason = adopt ? await adapter.season(current.externalId, 1) : undefined;
      if (nativeSeason && await matchExistingSeason(adapter, showId, current, nativeSeason)) return true;
      if (sources.length < 2) return unresolved.store(key, false);
      const titles = await mapConcurrent(sources, 3, source => source.id === current.externalId
        ? Promise.resolve(current) : adapter.details('show', source.id, false));
      const dates = titles.map(title => title.releaseDate);
      if (titles.some(title => !singleSeason(title) || title.externalIds?.tvdb !== current.externalIds?.tvdb) ||
          dates.some(date => !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) || new Set(dates).size !== titles.length)
        return unresolved.store(key, false);
      titles.sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!));
      stories = await mapConcurrent(titles, 3, async title => {
        const season = title.externalId === current.externalId && nativeSeason
          ? nativeSeason : await adapter.season(title.externalId, 1);
        return { title, season, episodes: season.children ?? [] };
      });
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || ![404, 410].includes(error.status)) throw error;
      return unresolved.store(key, false);
    }
    const episodeIds = stories.flatMap(story => story.episodes.map(episode => episode.externalId));
    if (episodeIds.length > maxGroupEpisodes || new Set(episodeIds).size !== episodeIds.length || stories.some(story =>
      !story.episodes.length || story.episodes.length > maxEpisodesPerStory ||
      story.episodes.some(episode => episode.episodeNumber === undefined || episode.episodeNumber < 1) ||
      new Set(story.episodes.map(episode => episode.episodeNumber)).size !== story.episodes.length
    )) return unresolved.store(key, false);
    const grouped = await getDb().transaction(tx => installAnthology(tx, showId, stories));
    if (!grouped) void logDiagnostic('warn', 'application.failed', {
      operation: 'catalogue', stage: 'anthology-identity', provider: 'tmdb', errorCode: 'catalogue.identity-conflict',
    });
    return grouped || unresolved.store(key, false);
  });
}

/** A library can already have the complete anthology hierarchy. Use two exact
 * episode identities to adopt a story without moving local episodes or files. */
async function matchExistingSeason(adapter: TmdbAdapter, showId: string, title: Metadata, native: Metadata) {
  const boundary = native.children?.filter(episode => episode.episodeNumber && Number.isSafeInteger(episode.episodeNumber));
  if (!boundary || boundary.length < 2) return false;
  const samples = [boundary[0], boundary[boundary.length - 1]];
  const find = async (examples: Metadata[]) => getDb().execute<{ id: string; season: string; source: string }>(sql`
    select distinct episode.media_id as id, episode.season_id as season, input.source
    from jsonb_to_recordset(${JSON.stringify(examples.flatMap(episode =>
      Object.entries({ ...episode.externalIds, tmdb: episode.externalId })
        .map(([provider, id]) => ({ provider, id, source: episode.externalId }))))}::text::jsonb)
      as input(provider text,id text,source text)
    join external_ids x on (x.provider,x.external_id,x.media_kind)=(input.provider,input.id,'episode')
    join episodes episode on episode.media_id=x.media_id
    where episode.show_id=${showId} and episode.season_number>0 and episode.season_id is not null`);
  let anchors = await find(samples);
  if (anchors.length < 2) {
    const detailed = await Promise.all(samples.map(episode =>
      adapter.episode(title.externalId, 1, episode.episodeNumber!, true)));
    if (detailed.some((episode, index) => episode.externalId !== samples[index].externalId)) return false;
    anchors = await find(detailed);
  }
  if (anchors.length !== 2 || new Set(anchors.map(anchor => anchor.source)).size !== 2 ||
      new Set(anchors.map(anchor => anchor.id)).size !== 2 || anchors[0].season !== anchors[1].season) return false;
  const seasonId = anchors[0].season;
  return getDb().transaction(async tx => {
    const ids = { [anthologyTmdb]: title.externalId, tmdb: native.externalId };
    for (const [provider, id] of Object.entries(ids))
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${provider}:season:${id}`},0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`show:${showId}`},0))`);
    const [season] = await tx.select().from(seasons).where(and(eq(seasons.mediaId, seasonId), eq(seasons.showId, showId)));
    if (!season) return false;
    const conflict = await tx.execute(sql`select 1 from external_ids x where x.media_kind='season' and (
      (x.provider=${anthologyTmdb} and ((x.external_id=${title.externalId} and x.media_id<>${seasonId})
        or (x.media_id=${seasonId} and x.external_id<>${title.externalId})))
      or (x.provider='tmdb' and x.external_id=${native.externalId} and x.media_id<>${seasonId})
    ) limit 1`);
    if (conflict.length) return false;
    await ingestMetadata({ ...native, title: title.title, seasonNumber: season.seasonNumber, externalIds: ids },
      { showId, mediaId: seasonId, complete: false, identitiesLocked: true }, tx);
    return true;
  });
}

/** Decide ownership before writing anything. A local UUID stays with its
 * proven story, even if its season number changes. */
function placements(stories: readonly Story[], oldSeasons: readonly LegacyRow[], oldEpisodes: readonly LegacyRow[]) {
  const byEpisode = new Map<string, number>();
  const bySeason = new Map<string, number>();
  const plans: Placement[] = stories.map(story => ({ story, episodes: new Map() }));
  for (const [index, story] of stories.entries()) {
    bySeason.set(story.season.externalId, index);
    for (const episode of story.episodes) byEpisode.set(episode.externalId, index);
  }
  const seasonOwners = new Map<string, Set<number>>();
  for (const row of oldEpisodes) {
    if (!row.aliases.length || row.aliases.some(id => !byEpisode.has(id))) return;
    const proven = row.watchedIds ?? [];
    const owners = new Set((proven.length ? proven : row.aliases).map(id => byEpisode.get(id)));
    if (row.ambiguous || owners.size !== 1 || owners.has(undefined)) return;
    const owner = [...owners][0]!;
    const [alias, extra] = row.aliases.filter(id => byEpisode.get(id) === owner);
    if (!alias || extra || plans[owner].episodes.has(alias)) return;
    plans[owner].episodes.set(alias, row.id);
    if (row.parent) {
      const parents = seasonOwners.get(row.parent) ?? new Set<number>();
      parents.add(owner);
      seasonOwners.set(row.parent, parents);
    }
  }
  for (const row of oldSeasons) {
    const children = seasonOwners.get(row.id);
    const claimed = new Set(row.aliases.map(id => bySeason.get(id)));
    const [owner] = children?.size === 1 ? children : claimed;
    if (owner === undefined || (children?.size ?? 0) > 1 || claimed.has(undefined) ||
        claimed.size > 1 && !children?.size ||
        row.direct && (claimed.size !== 1 || !claimed.has(owner)) || plans[owner].seasonId) return;
    plans[owner].seasonId = row.id;
  }
  return plans;
}

async function installAnthology(tx: CatalogueTransaction, showId: string, stories: readonly Story[]) {
  // Follow metadata ingestion's alias-before-show lock order. No provider IO holds a lock.
  const keys = new Set<string>();
  for (const story of stories) {
    keys.add(`${anthologyTmdb}:season:${story.title.externalId}`);
    for (const item of [story.title, story.season, ...story.episodes])
      for (const [provider, id] of Object.entries({ ...item.externalIds, tmdb: item.externalId }))
        keys.add(`${provider}:${item.kind}:${id}`);
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(key,0))
    from (select value as key from jsonb_array_elements_text(${JSON.stringify([...keys])}::text::jsonb)
      order by value collate "C") ordered`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`show:${showId}`},0))`);
  const sourceIds = stories.map(story => story.title.externalId);
  const currentSources = await tx.select({ id: externalIds.externalId }).from(externalIds)
    .where(and(eq(externalIds.mediaId, showId), eq(externalIds.provider, 'tmdb'), eq(externalIds.mediaKind, 'show')));
  if (currentSources.length !== sourceIds.length || currentSources.some(source => !sourceIds.includes(source.id))) return false;
  const completed = await tx.select({ id: externalIds.externalId }).from(externalIds)
    .where(and(eq(externalIds.provider, anthologyTmdb), eq(externalIds.mediaKind, 'season'), inArray(externalIds.externalId, sourceIds)));
  if (completed.length === stories.length) return true;
  const oldSeasons = await tx.execute(sql`
    select season.media_id as id,
      array(select x.external_id from external_ids x where x.media_id=season.media_id
        and x.provider='tmdb' and x.media_kind='season') as aliases
    from seasons season where season.show_id=${showId} and season.season_number<>0`) as LegacyRow[];
  const oldEpisodes = await tx.execute(sql`
    select e.media_id as id, e.season_id as parent,
      array(select x.external_id from external_ids x where x.media_id=e.media_id
        and x.provider='tmdb' and x.media_kind='episode') as aliases
    from episodes e where e.show_id=${showId} and e.season_number<>0`) as LegacyRow[];
  const currentChildren = new Set([...oldSeasons, ...oldEpisodes].map(row => row.id));
  const incomingIds = stories.flatMap(story => [story.season, ...story.episodes]);
  const owners = await tx.execute<{ id: string }>(sql`
    select x.media_id as id from jsonb_to_recordset(${JSON.stringify(incomingIds.map(item =>
      ({ id: item.externalId, kind: item.kind })))}::text::jsonb) as incoming(id text,kind text)
    join external_ids x on (x.provider,x.external_id,x.media_kind)=('tmdb',incoming.id,incoming.kind)`);
  if (owners.some(owner => !currentChildren.has(owner.id))) return false;
  const collisions = oldEpisodes.filter(row => row.aliases.length > 1);
  if (oldSeasons.length || collisions.length) {
    const ids = `{${[...oldSeasons, ...collisions].map(row => row.id).join(',')}}`;
    // The event FK takes a key-share lock on these rows before tracking locks its parents.
    await tx.execute(sql`select id from works where id=any(${ids}::uuid[]) order by id for update`);
  }
  if (collisions.length) {
    const ids = `{${collisions.map(row => row.id).join(',')}}`;
    const proofs = await tx.execute<{ id: string; ambiguous: boolean; watchedIds: string[] }>(sql`
      select te.media_id as id, bool_or(proven.id is null) as ambiguous,
        array_agg(distinct proven.id) filter(where proven.id is not null) as "watchedIds"
      from tracking_events te
      left join lateral (
        select distinct r.record->'episode'->'ids'->>'tmdb' as id
        from trakt_import_stages s join trakt_import_records r on r.stage_id=s.id
          and r.observed_media_id=te.media_id and r.applied
        where s.category='history' and te.source='trakt' and te.source_event_id=
          s.connection_id::text||':history:'||coalesce(r.record->>'id',r.record->'episode'->'ids'->>'trakt')||':'||(r.record->>'watched_at')
      ) proven on true where te.media_id=any(${ids}::uuid[]) group by te.media_id`);
    const byId = new Map(proofs.map(proof => [proof.id, proof]));
    for (const row of collisions) Object.assign(row, byId.get(row.id));
    const attachments = await tx.execute<{ id: string; sourceId: string | null }>(sql`
      select item.media_id as id,item.snapshot->'externalIds'->>'tmdb' as "sourceId"
      from provider_items item where item.media_id=any(${ids}::uuid[])`);
    for (const file of attachments)
      if (!file.sourceId || !byId.get(file.id)?.watchedIds?.includes(file.sourceId)) return false;
  }
  if (oldSeasons.length) {
    const ids = `{${oldSeasons.map(row => row.id).join(',')}}`;
    const links = await tx.execute<{ id: string }>(sql`
      select id from unnest(${ids}::uuid[]) target(id) where
        exists(select 1 from tracking_events e where e.media_id=target.id)
        or exists(select 1 from ratings r where r.media_id=target.id)
        or exists(select 1 from list_items l where l.media_id=target.id)
        or exists(select 1 from provider_items p where p.media_id=target.id)
        or exists(select 1 from media_requests r where r.media_id=target.id)
        or exists(select 1 from up_next n where n.media_id=target.id)
        or exists(select 1 from media_relationships r where r.child_id=target.id)`);
    const subjects = new Set(links.map(link => link.id));
    for (const row of oldSeasons) row.direct = subjects.has(row.id);
  }
  const plan = placements(stories, oldSeasons, oldEpisodes);
  if (!plan) return false;
  const originalBindings = new Map<string, string>(oldSeasons.flatMap(row =>
    row.aliases.map(alias => [`season:${alias}`, row.id] as const)));
  for (const row of oldEpisodes)
    for (const alias of row.aliases) originalBindings.set(`episode:${alias}`, row.id);
  await tx.execute(sql`select id from media where id=${showId} or id in (
    select media_id from seasons where show_id=${showId} and season_number<>0
  ) order by case when id=${showId} then 0 else 1 end,id for no key update`);
  const parents = oldSeasons.map(season => season.id);
  const leaves = oldEpisodes.map(episode => episode.id);
  if (parents.length)
    await tx.update(seasons).set({ seasonNumber: sql`-${seasons.seasonNumber}` }).where(inArray(seasons.mediaId, parents));
  if (leaves.length)
    await tx.update(episodes).set({ seasonNumber: sql`-${episodes.seasonNumber}` }).where(inArray(episodes.mediaId, leaves));
  for (const [index, { story, seasonId, episodes: owned }] of plan.entries()) {
    const seasonNumber = index + 1;
    if (seasonId)
      await tx.update(seasons).set({ seasonNumber }).where(eq(seasons.mediaId, seasonId));
    const formerSeason = originalBindings.get(`season:${story.season.externalId}`);
    if (formerSeason && formerSeason !== seasonId)
      await tx.delete(externalIds).where(and(eq(externalIds.provider, 'tmdb'), eq(externalIds.mediaKind, 'season'),
        eq(externalIds.externalId, story.season.externalId), eq(externalIds.mediaId, formerSeason)));
    const savedSeason = await ingestMetadata({
      ...story.season, title: story.title.title, seasonNumber,
      externalIds: { ...story.season.externalIds, [anthologyTmdb]: story.title.externalId },
    }, { showId, mediaId: seasonId, complete: true, identitiesLocked: true }, tx);
    for (const episode of story.episodes) {
      const mediaId = owned.get(episode.externalId);
      if (mediaId)
        await tx.update(episodes).set({ seasonId: savedSeason.id, seasonNumber, episodeNumber: episode.episodeNumber })
          .where(eq(episodes.mediaId, mediaId));
      const formerEpisode = originalBindings.get(`episode:${episode.externalId}`);
      if (formerEpisode && formerEpisode !== mediaId)
        await tx.delete(externalIds).where(and(eq(externalIds.provider, 'tmdb'), eq(externalIds.mediaKind, 'episode'),
          eq(externalIds.externalId, episode.externalId), eq(externalIds.mediaId, formerEpisode)));
      await ingestMetadata({ ...episode, seasonNumber }, { showId, seasonId: savedSeason.id, mediaId, identitiesLocked: true }, tx);
    }
  }
  await ingestMetadata(stories[0].title, { mediaId: showId, complete: true, identitiesLocked: true }, tx);
  return true;
}
