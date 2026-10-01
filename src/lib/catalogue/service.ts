import { mapConcurrent, singleFlight } from '$lib/server/utils/async';
import { and, eq, inArray, isNull, or, sql, desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  media,
  movies,
  shows,
  seasons,
  episodes,
  externalIds,
  metadataSnapshots,
  providerInstances,
  mediaRelationships,
  users,
} from '$lib/server/db/schema';
import { mediaViews } from '$lib/server/queries/media';
import { createProviderTransport } from '$lib/server/security/provider-fetch';
import { decryptCredential } from '$lib/server/security/credentials';
import { TmdbAdapter } from '$lib/providers/tmdb/adapter.server';
import type { DiscoverKind, Metadata } from '$lib/providers/contracts';

export async function getTmdb(language = 'en-US', region = 'GB') {
  const [instance] = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'tmdb'), eq(providerInstances.enabled, true)))
    .limit(1);
  if (!instance?.credentials) return null;
  const credentials = JSON.parse(await decryptCredential(instance.credentials)) as {
    apiKey?: string;
    accessToken?: string;
  };
  const request = createProviderTransport({
    baseUrl: 'https://api.themoviedb.org',
    approved: true,
    allowedPorts: [443],
  });
  return new TmdbAdapter(
    (path, init = {}) =>
      request(
        credentials.apiKey
          ? `${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(credentials.apiKey)}`
          : path,
        {
          ...init,
          headers: {
            ...init.headers,
            ...(credentials.accessToken
              ? { Authorization: `Bearer ${credentials.accessToken}` }
              : {}),
          },
        }
      ),
    language,
    region
  );
}
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
    genres: metadata.genres ?? [],
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
    let mediaId = options.mediaId;
    if (!mediaId) {
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
              mediaId = undefined;
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
          genres: values.genres,
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
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`metadata:${mediaId}`},0))`
    );
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
        ([key]) => options.complete || metadata[key as keyof typeof values] !== undefined
      )
    );
    const raw = {
      ...(snapshot?.raw ?? {}),
      ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)),
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
export async function importTmdbCollection(id: string, region = 'GB') {
  const adapter = await getTmdb('en-US', region);
  if (!adapter) throw new Error('Configure TMDB to refresh collection details.');
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

async function refreshChildDetails(id: string, region: string) {
  const db = getDb(),
    adapter = await getTmdb('en-US', region);
  if (!adapter) throw new Error('Configure TMDB to refresh these details.');
  const [season] = await db.select().from(seasons).where(eq(seasons.mediaId, id));
  const [episode] = season ? [] : await db.select().from(episodes).where(eq(episodes.mediaId, id));
  const child = season ?? episode;
  if (!child) throw new Error('This title has no episode or season details.');
  const [show] = await db
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, child.showId), eq(externalIds.provider, 'tmdb')));
  if (!show) throw new Error('The show needs a TMDB match before these details can be refreshed.');
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

const sharedRefresh = singleFlight<Awaited<ReturnType<typeof importTmdb>>>();
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
  if (identity?.mediaKind === 'collection')
    return importTmdbCollection(identity.externalId, region);
  if (identity?.mediaKind === 'season' || identity?.mediaKind === 'episode')
    return refreshChildDetails(id, region);
  if (!identity || (identity.mediaKind !== 'show' && identity.mediaKind !== 'movie'))
    throw new Error('This title has no refreshable TMDB identity.');
  return importTmdb(identity.mediaKind, identity.externalId, { region, includeRecommendations });
}
/** Refresh only a relevant detail page when its regional snapshot is missing or stale. */
export async function ensureDetails(userId: string, id: string) {
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
  if (!identity) {
    const [child] = await getDb().select().from(media).where(eq(media.id, id));
    if (!child || !['season', 'episode'].includes(child.kind) || !(await getTmdb('en-US', region)))
      return false;
    await sharedRefresh(`details:${id}:${region}`, () => refreshChildDetails(id, region));
    return true;
  }
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
    (identity.mediaKind === 'collection' || snapshot.raw.detailVersion === 3) &&
    Date.now() - Date.parse(String(snapshot.raw.detailsUpdatedAt)) < 7 * 86400000
  )
    return false;
  if (!(await getTmdb('en-US', region))) return false;
  await sharedRefresh(`details:${id}:${region}`, async () => {
    if (identity.mediaKind === 'movie' || identity.mediaKind === 'show')
      return importTmdb(identity.mediaKind, identity.externalId, {
        region,
        includeEpisodes: false,
      });
    if (identity.mediaKind === 'collection') return refreshMedia(id, region);
    return refreshChildDetails(id, region);
  });
  return true;
}
async function seerrDiscovery(userId: string) {
  const instances = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'seerr'), eq(providerInstances.enabled, true)));
  const { getSeerr } = await import('$lib/providers/seerr/connection.server');
  for (const instance of instances)
    try {
      return (await getSeerr(userId, instance.id)).adapter;
    } catch {}
  return null;
}
export async function searchMedia(userId: string, query: string) {
  const needle = query.trim().slice(0, 200);
  if (!needle) return { items: [], providerUnavailable: false, truncated: false };
  let providerUnavailable = false;
  try {
    const adapter = (await getTmdb()) || (await seerrDiscovery(userId));
    if (adapter)
      await mapConcurrent(await adapter.search(needle), 4, (item) => ingestMetadata(item));
  } catch {
    providerUnavailable = true;
  }
  // Shared resolution includes the user's chosen title, administrator overrides and original titles.
  // Availability is ranked in PostgreSQL before the limit, including a show's permitted episodes.
  const items = await mediaViews(userId, { query: needle, availableFirst: true, limit: 101 });
  return { items: items.slice(0, 100), providerUnavailable, truncated: items.length > 100 };
}
export async function discoverMedia(userId: string | null) {
  const tmdb = await getTmdb();
  const adapter = tmdb || (userId ? await seerrDiscovery(userId) : null);
  let providerUnavailable = false;
  const trending: string[] = [],
    recent: string[] = [];
  if (adapter) {
    await Promise.all(
      (
        [
          [trending, () => adapter.trending()],
          [recent, () => (tmdb ? tmdb.recent('movie') : Promise.resolve([]))],
        ] as const
      ).map(async ([bucket, fetcher]) => {
        try {
          const saved = await mapConcurrent(await fetcher(), 4, (item) => ingestMetadata(item));
          bucket.push(...saved.map((item) => item.id));
        } catch {
          providerUnavailable = true;
        }
      })
    );
  }
  const items = await resolveDiscoveryItems([...trending, ...recent]);
  return { items, trending, recent, configured: !!adapter, providerUnavailable };
}

/** Explicit shelf membership survives unrelated catalogue writes during discovery ingestion. */
export async function resolveDiscoveryItems(bucketIds: string[]) {
  const selectedIds = [...new Set(bucketIds)];
  if (selectedIds.length) {
    const selected = await getDb().select().from(media).where(inArray(media.id, selectedIds));
    const selectedById = new Map(selected.map((item) => [item.id, item]));
    return selectedIds.flatMap((id) => {
      const item = selectedById.get(id);
      return item ? [item] : [];
    });
  }
  return getDb()
    .select()
    .from(media)
    .where(or(eq(media.kind, 'movie'), eq(media.kind, 'show')))
    .orderBy(desc(media.updatedAt))
    .limit(80);
}
