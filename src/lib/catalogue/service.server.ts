import { getFeatureConfig, requireFeature } from '#lib/server/features.js';
import { mapConcurrent } from '#lib/server/utils/async.js';
import { searchFallback, searchScore } from '#lib/search.js';
import { providerSingleFlight } from '#lib/server/utils/provider-single-flight.js';
import { providerCache } from '#lib/server/utils/provider-cache.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import {
  media,
  movies,
  shows,
  seasons,
  episodes,
  externalIds,
  metadataSnapshots,
  workFeatures,
  providerInstances,
  mediaRelationships,
  users,
} from '#lib/server/db/schema.js';
import { mediaViews } from '#lib/server/queries/media.js';
import { getTmdb } from '#lib/providers/tmdb/connection.server.js';
import { screenListings } from '#lib/providers/screen-discovery.server.js';
import { screenListingIds } from '#lib/recommendations/screen-ranking.js';
import type { DiscoverKind, Metadata } from '#lib/providers/contracts.js';
import type { DiscoverySection } from '#lib/discovery.js';

function snapshotValues(metadata: Metadata) {
  return {
    title: metadata.title,
    originalTitle: metadata.originalTitle ?? null,
    overview: metadata.overview ?? null,
    posterPath: metadata.posterPath ?? null,
    backdropPath: metadata.backdropPath ?? null,
    releaseDate:
      metadata.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(metadata.releaseDate)
        ? metadata.releaseDate
        : null,
    runtimeMinutes: metadata.runtimeMinutes ?? null,
    genres: metadata.genres ?? null,
    certificate: metadata.certificate ?? null,
  };
}
/** Retain a provider snapshot independently of presentation overrides and canonical history. */
export async function ingestMetadata(
  metadata: Metadata,
  options: {
    instanceId?: string;
    showId?: string;
    seasonId?: string;
    mediaId?: string;
    complete?: boolean;
    isolateConflictingProviderIds?: boolean;
  } = {}
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const identityProvider =
      metadata.provider === 'jellyfin' ? `jellyfin:${options.instanceId}` : metadata.provider;
    let ids = { ...metadata.externalIds, [identityProvider]: metadata.externalId };
    for (const key of Object.entries(ids)
      .map(([provider, id]) => `${provider}:${metadata.kind}:${id}`)
      .sort())
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`);
    if (options.showId)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`show:${options.showId}`},0))`
      );
    const [scopedIdentity] = metadata.provider === 'jellyfin' && options.isolateConflictingProviderIds
      ? await tx.select({mediaId: externalIds.mediaId}).from(externalIds).where(and(
          eq(externalIds.provider, identityProvider), eq(externalIds.externalId, metadata.externalId),
          eq(externalIds.mediaKind, metadata.kind)))
      : [];
    let mediaId = options.mediaId ?? scopedIdentity?.mediaId;
    if (!options.mediaId) {
      for (const [provider, externalId] of Object.entries(ids)) {
        const [mapping] = await tx
          .select()
          .from(externalIds)
          .where(
            and(
              eq(externalIds.provider, provider),
              eq(externalIds.externalId, externalId),
              eq(externalIds.mediaKind, metadata.kind)
            )
          )
          .limit(1);
        if (mapping) {
          if (mediaId && mediaId !== mapping.mediaId) {
            if (options.isolateConflictingProviderIds && metadata.provider === 'jellyfin') {
              // Preserve the Jellyfin item's identity without merging two canonical records.
              // Conflicting third-party IDs remain in the provider snapshot for later review.
              ids = { [identityProvider]: metadata.externalId };
              mediaId = scopedIdentity?.mediaId;
              break;
            }
            throw new Error('Conflicting provider identities require administrator review.');
          }
          mediaId = mapping.mediaId;
        }
      }
    }
    if (!mediaId && metadata.kind === 'season' && options.showId) {
      const [existing] = await tx
        .select()
        .from(seasons)
        .where(
          and(
            eq(seasons.showId, options.showId),
            eq(seasons.seasonNumber, metadata.seasonNumber ?? 0)
          )
        );
      mediaId = existing?.mediaId;
    }
    if (!mediaId && metadata.kind === 'episode' && options.showId) {
      const [existing] = await tx
        .select()
        .from(episodes)
        .where(
          and(
            eq(episodes.showId, options.showId),
            eq(episodes.seasonNumber, metadata.seasonNumber ?? 0),
            eq(episodes.episodeNumber, metadata.episodeNumber ?? 0)
          )
        );
      mediaId = existing?.mediaId;
    }
    const values = snapshotValues(metadata);
    let addedEpisode = false;
    if (!mediaId) {
      const [created] = await tx
        .insert(media)
        .values({
          kind: metadata.kind,
          title: values.title,
          originalTitle: values.originalTitle,
          overview: values.overview,
          posterPath: values.posterPath,
          backdropPath: values.backdropPath,
          releaseDate: values.releaseDate,
          year: values.releaseDate ? Number(values.releaseDate.slice(0, 4)) : null,
          runtimeMinutes: values.runtimeMinutes,
          genres: values.genres ?? [],
        })
        .returning();
      mediaId = created.id;
      if (metadata.kind === 'movie') await tx.insert(movies).values({ mediaId });
      if (metadata.kind === 'show') await tx.insert(shows).values({ mediaId });
      if (metadata.kind === 'season') {
        if (!options.showId) throw new Error('A season requires its canonical show.');
        await tx
          .insert(seasons)
          .values({ mediaId, showId: options.showId, seasonNumber: metadata.seasonNumber ?? 0 });
      }
      if (metadata.kind === 'episode') {
        if (!options.showId) throw new Error('An episode requires its canonical show.');
        addedEpisode = true;
        await tx.insert(episodes).values({
          mediaId,
          showId: options.showId,
          seasonId: options.seasonId,
          seasonNumber: metadata.seasonNumber ?? 0,
          episodeNumber: metadata.episodeNumber ?? 0,
          isSpecial: metadata.seasonNumber === 0,
          runtimeMinutes: metadata.runtimeMinutes,
        });
      }
    }
    if (addedEpisode) {
      for (const [parentId, column] of [[options.showId, sql`show_id`], [options.seasonId, sql`season_id`]] as const) {
        if (!parentId) continue;
        await tx.select({ id: media.id }).from(media).where(eq(media.id,parentId)).for('no key update');
        // Take row locks before the aggregate statement gets its snapshot. Tracking
        // uses the same parent-row fence before reading its children.
        await tx.execute(sql`select user_id from tracking_state where media_id=${parentId} order by user_id for update`);
        await tx.execute(sql`update tracking_state t set
          total_episodes = (select count(*) from episodes e where e.${column}=${parentId} and not e.is_special),
          completed_episodes = (select count(*) from episodes e join tracking_state child on child.media_id=e.media_id and child.user_id=t.user_id where e.${column}=${parentId} and not e.is_special and child.watched),
          watched = not exists(select 1 from episodes e left join tracking_state child on child.media_id=e.media_id and child.user_id=t.user_id where e.${column}=${parentId} and not e.is_special and not coalesce(child.watched,false))
            and exists(select 1 from episodes e where e.${column}=${parentId} and not e.is_special), updated_at=now()
          where t.media_id=${parentId}`);
      }
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`metadata:${mediaId}`},0))`
    );
    if(metadata.tasteFeatures!==undefined)await tx.insert(workFeatures).values({workId:mediaId,provider:metadata.provider,features:metadata.tasteFeatures}).onConflictDoUpdate({target:[workFeatures.workId,workFeatures.provider],set:{features:sql`excluded.features`,updatedAt:new Date()}});
    for (const [provider, externalId] of Object.entries(ids))
      await tx
        .insert(externalIds)
        .values({ mediaId, provider, externalId, mediaKind: metadata.kind })
        .onConflictDoNothing();
    const language = metadata.language || 'en-US';
    const region = metadata.region || 'GB';
    const snapshotKey = and(
      eq(metadataSnapshots.mediaId, mediaId),
      eq(metadataSnapshots.provider, metadata.provider),
      options.instanceId
        ? eq(metadataSnapshots.instanceId, options.instanceId)
        : isNull(metadataSnapshots.instanceId),
      eq(metadataSnapshots.language, language),
      eq(metadataSnapshots.region, region)
    );
    const [snapshot] = await tx.select().from(metadataSnapshots).where(snapshotKey).limit(1);
    const suppliedValues = Object.fromEntries(
      Object.entries(values).filter(
        ([key]) => (options.complete && key !== 'genres') || metadata[key as keyof typeof values] !== undefined
      )
    );
    const raw = {
      ...(snapshot?.raw ?? {}),
      ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)),
      ...(metadata.facts ? { facts: {
        ...((snapshot?.raw.facts as Metadata['facts']) ?? {}),
        ...Object.fromEntries(Object.entries(metadata.facts).filter(([, value]) => value !== undefined)),
      } } : {}),
      ...(metadata.artwork && !metadata.artworkUpdatedAt
        ? {
            artwork: {
              ...((snapshot?.raw.artwork as Record<string, unknown>) ?? {}),
              ...Object.fromEntries(
                Object.entries(metadata.artwork).filter(([, value]) => value !== undefined)
              ),
            },
          }
        : {}),
      ...(options.complete
        ? { detailLoaded: true, detailVersion: 3, detailsUpdatedAt: new Date().toISOString() }
        : {}),
    };
    const data = { ...suppliedValues, raw, updatedAt: new Date() };
    if (snapshot)
      await tx.update(metadataSnapshots).set(data).where(eq(metadataSnapshots.id, snapshot.id));
    else
      await tx.insert(metadataSnapshots).values({
        mediaId,
        provider: metadata.provider,
        instanceId: options.instanceId,
        language,
        region,
        ...data,
      });
    const [saved] = await tx.select().from(media).where(eq(media.id, mediaId));
    return saved;
  });
}
export async function importTmdb(
  kind: DiscoverKind,
  id: string,
  options: { includeEpisodes?: boolean; includeRecommendations?: boolean; language?: string; region?: string } = {}
) {
  const adapter = await getTmdb(options.language, options.region);
  if (!adapter) throw new Error('Configure TMDB in Settings to add global catalogue titles.');
  return importTmdbTitle(adapter, kind, id, options);
}
type Tmdb = NonNullable<Awaited<ReturnType<typeof getTmdb>>>;

async function importTmdbTitle(adapter: Tmdb, kind: DiscoverKind, id: string,
  options: { includeEpisodes?: boolean; includeRecommendations?: boolean }
) {
  const snapshot = await adapter.details(kind, id, options.includeRecommendations !== false);
  const saved = await ingestMetadata(snapshot);
  const recommendations: (typeof mediaRelationships.$inferInsert)[] = [];
  const relatedItems = await mapConcurrent(options.includeRecommendations === false ? [] : snapshot.recommendations ?? [], 4, (item) =>
    ingestMetadata(item)
  );
  for (const [position, related] of relatedItems.entries()) {
    if (related.id !== saved.id)
      recommendations.push({
        parentId: saved.id,
        childId: related.id,
        kind: 'related' as const,
        position,
      });
  }
  await getDb().transaction(async (tx) => {
    if (recommendations.length)
      await tx
        .insert(mediaRelationships)
        .values(recommendations)
        .onConflictDoUpdate({
          target: [
            mediaRelationships.parentId,
            mediaRelationships.childId,
            mediaRelationships.kind,
          ],
          set: { position: sql`excluded.position` },
        });
  });
  if (snapshot.collection) {
    const collection = await ingestMetadata({
      provider: 'tmdb',
      externalId: snapshot.collection.id,
      kind: 'collection',
      title: snapshot.collection.name,
    });
    await getDb()
      .insert(mediaRelationships)
      .values({ parentId: collection.id, childId: saved.id, kind: 'collection' })
      .onConflictDoNothing();
  }
  if (kind === 'show')
    await mapConcurrent(snapshot.children || [], 3, async (shell) => {
      const seasonSnapshot =
        options.includeEpisodes === false ? shell : await adapter.season(id, shell.seasonNumber!);
      const season = await ingestMetadata(seasonSnapshot, {
        showId: saved.id,
        complete: options.includeEpisodes !== false,
      });
      for (const episode of seasonSnapshot.children || [])
        await ingestMetadata(episode, { showId: saved.id, seasonId: season.id });
    });
  await ingestMetadata(snapshot, {
    mediaId: saved.id,
    complete: true,
  });
  return saved;
}
async function importTmdbCollection(id: string, adapter: Tmdb) {
  const snapshot = await adapter.collection(id),
    saved = await ingestMetadata(snapshot);
  for (const [position, part] of (snapshot.children ?? []).entries()) {
    const child = await ingestMetadata(part);
    await getDb()
      .insert(mediaRelationships)
      .values({ parentId: saved.id, childId: child.id, kind: 'collection', position })
      .onConflictDoUpdate({
        target: [mediaRelationships.parentId, mediaRelationships.childId, mediaRelationships.kind],
        set: { position },
      });
  }
  await ingestMetadata(snapshot, { mediaId: saved.id, complete: true });
  return saved;
}

async function tmdbChild(id: string) {
  const db = getDb();
  const [season] = await db.select().from(seasons).where(eq(seasons.mediaId, id));
  const [episode] = season ? [] : await db.select().from(episodes).where(eq(episodes.mediaId, id));
  const child = season ?? episode;
  if (!child) return;
  const [show] = await db
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, child.showId), eq(externalIds.provider, 'tmdb')));
  if (show) return { child, season, episode, show };
}

async function refreshChildDetails(id: string, region: string) {
  const adapter = await getTmdb('en-US', region);
  if (!adapter) throw new Error('Configure TMDB to refresh these details.');
  const target = await tmdbChild(id);
  if (!target) throw new Error('The show needs a TMDB match before these details can be refreshed.');
  return importTmdbChild(id, adapter, target);
}

async function importTmdbChild(id: string, adapter: Tmdb, {
  child, season, episode, show,
}: NonNullable<Awaited<ReturnType<typeof tmdbChild>>>) {
  const snapshot = season
    ? await adapter.season(show.externalId, child.seasonNumber)
    : await adapter.episode(show.externalId, child.seasonNumber, episode!.episodeNumber);
  const saved = await ingestMetadata(snapshot, {
    mediaId: id,
    showId: child.showId,
    seasonId: episode?.seasonId ?? undefined,
    complete: true,
  });
  if (season)
    await mapConcurrent(snapshot.children ?? [], 4, (item) =>
      ingestMetadata(item, { showId: season.showId, seasonId: id })
    );
  return saved;
}

const sharedRefresh = providerSingleFlight<Awaited<ReturnType<typeof importTmdb>>>('tmdb-refresh');
const optionalRefresh = providerSingleFlight<boolean>('tmdb-detail-enrichment');
const missingDetails = providerCache<null>(100, 5 * 60_000);
export function refreshMedia(id: string, region = 'GB', includeRecommendations = true) {
  return sharedRefresh(`${id}:${region}:${includeRecommendations}`, () => refreshMediaNow(id, region, includeRecommendations));
}
async function refreshMediaNow(id: string, region = 'GB', includeRecommendations = true) {
  const [identity] = await getDb()
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, id), eq(externalIds.provider, 'tmdb')))
    .limit(1);
  if (!identity) {
    const [item] = await getDb().select({ kind: media.kind }).from(media).where(eq(media.id, id));
    if (item && ['season', 'episode'].includes(item.kind)) return refreshChildDetails(id, region);
  }
  if (identity?.mediaKind === 'collection') {
    const adapter = await getTmdb('en-US', region);
    if (!adapter) throw new Error('Configure TMDB to refresh collection details.');
    return importTmdbCollection(identity.externalId, adapter);
  }
  if (identity?.mediaKind === 'season' || identity?.mediaKind === 'episode')
    return refreshChildDetails(id, region);
  if (!identity || (identity.mediaKind !== 'show' && identity.mediaKind !== 'movie'))
    throw new Error('This title has no refreshable TMDB identity.');
  return importTmdb(identity.mediaKind, identity.externalId, { region, includeRecommendations });
}
/** Refresh only a relevant detail page when its regional snapshot is missing or stale. */
export async function ensureDetails(userId: string, id: string) {
  await requireFeature(userId,'screen');
  const [viewer] = await getDb()
    .select({ settings: users.settings })
    .from(users)
    .where(eq(users.id, userId));
  const region = viewer?.settings.region ?? 'GB';
  const [identity] = await getDb()
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, id), eq(externalIds.provider, 'tmdb')))
    .limit(1);
  const [snapshot] = await getDb()
    .select({ raw: metadataSnapshots.raw })
    .from(metadataSnapshots)
    .where(
      and(
        eq(metadataSnapshots.mediaId, id),
        eq(metadataSnapshots.provider, 'tmdb'),
        eq(metadataSnapshots.region, region)
      )
    )
    .limit(1);
  if (
    snapshot?.raw.detailLoaded === true &&
    (identity?.mediaKind === 'collection' || snapshot.raw.detailVersion === 3) &&
    Date.now() - Date.parse(String(snapshot.raw.detailsUpdatedAt)) < 7 * 86400000
  )
    return false;
  const adapter = await getTmdb('en-US', region);
  if (!adapter) return false;
  const kind = identity?.mediaKind;
  const child = !kind || kind === 'episode' || kind === 'season' ? await tmdbChild(id) : undefined;
  if (!child && (!identity || kind === 'episode' || kind === 'season')) return false;
  const key = JSON.stringify([adapter.cacheScope, region, id, identity?.externalId,
    child?.show.externalId, child?.child.seasonNumber, child?.episode?.episodeNumber]);
  if (missingDetails.peek(key) === null) return false;
  return optionalRefresh(key, async () => {
    try {
      if (child) await importTmdbChild(id, adapter, child);
      else if (identity?.mediaKind === 'movie' || identity?.mediaKind === 'show')
        await importTmdbTitle(adapter, identity.mediaKind, identity.externalId, { includeEpisodes: false });
      else if (identity?.mediaKind === 'collection')
        await sharedRefresh(`${id}:${region}:true`, () => importTmdbCollection(identity.externalId, adapter));
      else return false;
      return true;
    } catch (cause) {
      if (!(cause instanceof ProviderHttpError) || ![404, 410].includes(cause.status)) throw cause;
      missingDetails.store(key, null);
      return false;
    }
  });
}
async function seerrDiscovery(userId: string, signal?: AbortSignal) {
  const instances = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'seerr'), eq(providerInstances.enabled, true)));
  const { getSeerr } = await import('#lib/providers/seerr/connection.server.js');
  for (const instance of instances)
    try {
      return (await getSeerr(userId, instance.id,undefined,signal)).adapter;
    } catch { signal?.throwIfAborted(); }
  return null;
}
export async function searchMedia(userId: string, query: string) {
  const needle = query.trim().slice(0, 200);
  if (!needle || !(await getFeatureConfig(userId)).features.screen) return { items: [], providerUnavailable: false, truncated: false };
  let providerUnavailable = false;
  try {
    const adapter = (await getTmdb()) || (await seerrDiscovery(userId));
    if (adapter) {
      let found = await adapter.search(needle);
      const fallback = searchFallback(needle);
      if (!found.length && fallback)
        found = (await adapter.search(fallback)).filter(item => searchScore(needle, item) >= 550);
      await mapConcurrent(found, 4, (item) => ingestMetadata(item));
    }
  } catch {
    providerUnavailable = true;
  }
  // Shared resolution includes the user's chosen title, administrator overrides and original titles.
  // Availability is ranked in PostgreSQL before the limit, including a show's permitted episodes.
  const items = await mediaViews(userId, { query: needle, availableFirst: true, limit: 101 });
  return { items: items.slice(0, 100), providerUnavailable, truncated: items.length > 100 };
}
const importListing = providerSingleFlight<string>('screen-discovery-import');
/** Resolve the whole provider page by verified aliases before importing. Normal
 * revisits perform one lookup and hydrate cards without rewriting snapshots. */
export async function persistScreenListings(items: readonly Metadata[], signal?: AbortSignal) {
  if (!items.length) return [];
  const candidates = items.slice(0,60).map(item=>({item,aliases:screenListingIds(item)}));
  const aliases = candidates.flatMap(({item,aliases})=>aliases.map(([provider,external_id])=>({provider,external_id,kind:item.kind})));
  const stored = await withReadCancellation(signal,async()=>getDb().execute<{provider:string;external_id:string;kind:string;media_id:string}>(sql`
    select x.provider,x.external_id,x.media_kind as kind,x.media_id from external_ids x
    join jsonb_to_recordset(${JSON.stringify(aliases)}::text::jsonb) as identity(provider text,external_id text,kind text)
      on (x.provider,x.external_id,x.media_kind) = (identity.provider,identity.external_id,identity.kind)`));
  signal?.throwIfAborted();
  const known = new Map(stored.map(row=>[`${row.kind}:${row.provider}:${row.external_id}`,row.media_id]));
  const resolved = await mapConcurrent(candidates,4,async ({item,aliases})=>{
    signal?.throwIfAborted();
    if (!aliases.length) return;
    const keys = aliases.map(([provider,id])=>`${item.kind}:${provider}:${id}`);
    const ids = new Set(keys.flatMap(key=>known.has(key)?[known.get(key)!]:[]));
    if (ids.size>1) return; // An ambiguous provider result cannot merge canonical works.
    if (ids.size===1 && aliases.some(([provider,id])=>(provider==='tmdb'||provider==='trakt') && known.has(`${item.kind}:${provider}:${id}`)))
      return ids.values().next().value;
    const identity = keys.find(key=>key.startsWith(`${item.kind}:tmdb:`)) ?? keys[0];
    return importListing(identity,async ()=>(await ingestMetadata({...item,externalIds:Object.fromEntries(aliases)})).id);
  });
  signal?.throwIfAborted();
  return [...new Set(resolved.filter((id):id is string=>!!id))];
}

export async function discoverMedia(userId: string | null, section?: DiscoverySection, signal: AbortSignal = new AbortController().signal) {
  const {features}=await getFeatureConfig(userId);
  if(!features.screen)return {trending:[],recent:[],configured:true,providerUnavailable:false};
  const names: DiscoverySection[] = section ? [section] : ['trending','recent'];
  const results = await Promise.all(names.map(async name=>{
    const result = await screenListings('all',name,undefined,signal);
    let {items,configured,failed} = result;
    // Seerr mirrors TMDB's trending list. Use the admitted linked account only
    // as a fallback when the public listing sources couldn't supply it.
    if (!items.length && name==='trending' && userId && features.requests) {
      const adapter = await seerrDiscovery(userId,signal);
      configured ||= !!adapter;
      if (adapter) try { items=(await adapter.trending()).slice(0,20); }
      catch { signal.throwIfAborted(); failed=true; }
    }
    try { return {name,ids:await persistScreenListings(items,signal),configured,failed}; }
    catch { signal.throwIfAborted(); return {name,ids:[],configured,failed:true}; }
  }));
  const trending=results.find(result=>result.name==='trending')?.ids??[];
  const recent=results.find(result=>result.name==='recent')?.ids??[];
  return {trending,recent,configured:results.some(result=>result.configured),providerUnavailable:results.some(result=>result.failed)};
}
