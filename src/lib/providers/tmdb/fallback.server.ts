import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { media, metadataSnapshots, externalIds, episodes, seasons } from '$lib/server/db/schema';
import { getTmdb, ingestMetadata } from '$lib/catalogue/service';
import { getConfig } from '$lib/server/config';
import type { ArtworkImages } from '$lib/artwork';
import { tmdbArtworkUrl } from './artwork.server';

const pending = new Map<string, Promise<ArtworkImages>>();
async function lookup(id: string): Promise<ArtworkImages> {
  const db = getDb();
  const [snapshot] = await db
    .select()
    .from(metadataSnapshots)
    .where(and(eq(metadataSnapshots.mediaId, id), eq(metadataSnapshots.provider, 'tmdb')))
    .orderBy(desc(metadataSnapshots.updatedAt))
    .limit(1);
  if (
    snapshot?.raw.artwork &&
    Date.now() - Date.parse(String(snapshot.raw.artworkUpdatedAt ?? '')) < 7 * 86400000
  )
    return snapshot.raw.artwork as ArtworkImages;
  const [item] = await db.select().from(media).where(eq(media.id, id));
  const adapter = await getTmdb();
  if (!item || !adapter) return {};
  const identity = async (mediaId: string) =>
    (
      await db
        .select()
        .from(externalIds)
        .where(and(eq(externalIds.mediaId, mediaId), eq(externalIds.provider, 'tmdb')))
        .limit(1)
    )[0]?.externalId;
  if (item.kind === 'episode' || item.kind === 'season') {
    const [child] =
      item.kind === 'episode'
        ? await db.select().from(episodes).where(eq(episodes.mediaId, id))
        : await db.select().from(seasons).where(eq(seasons.mediaId, id));
    if (!child) return {};
    const showId = await identity(child.showId);
    if (!showId) return {};
    const season = await adapter.season(showId, child.seasonNumber);
    const metadata =
      item.kind === 'season'
        ? season
        : season.children?.find(
            (episode) =>
              episode.episodeNumber === ('episodeNumber' in child ? child.episodeNumber : -1)
          );
    if (!metadata) return {};
    const values = {
      posterPath: metadata.posterPath,
      backdropPath: metadata.backdropPath,
      raw: {
        ...snapshot?.raw,
        artwork: metadata.artwork ?? {},
        artworkUpdatedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    };
    if (snapshot)
      await db.update(metadataSnapshots).set(values).where(eq(metadataSnapshots.id, snapshot.id));
    else
      await db
        .insert(metadataSnapshots)
        .values({ mediaId: id, provider: 'tmdb', language: 'en-US', region: 'GB', ...values });
    return metadata.artwork ?? {};
  }
  const tmdbId = await identity(id);
  if (!tmdbId) return {};
  const metadata =
    item.kind === 'collection'
      ? await adapter.collection(tmdbId)
      : await adapter.details(item.kind, tmdbId);
  await ingestMetadata(metadata);
  return metadata.artwork ?? {};
}

/** Resolve only supported TMDB images, on demand; never fetch image bytes during catalogue reads. */
export async function fallbackArtwork(id: string, type: string) {
  if (!['primary', 'backdrop', 'thumb', 'logo'].includes(type))
    return new Response('Image unavailable.', { status: 404 });
  const db = getDb();
  const [episode] = await db.select().from(episodes).where(eq(episodes.mediaId, id));
  const [season] = episode ? [] : await db.select().from(seasons).where(eq(seasons.mediaId, id));
  const lineage = [
    ...new Set(
      [id, episode?.seasonId, episode?.showId ?? season?.showId].filter((value): value is string =>
        Boolean(value)
      )
    ),
  ];
  let source: string | undefined;
  const fallbacks: ArtworkImages[] = [];
  for (const mediaId of lineage) {
    let work = pending.get(mediaId);
    if (!work) {
      work = lookup(mediaId).finally(() => pending.delete(mediaId));
      pending.set(mediaId, work);
    }
    const artwork = await work;
    fallbacks.push(artwork);
    source = artwork[type as keyof ArtworkImages];
    if (source) break;
  }
  if (!source && type === 'thumb')
    source = fallbacks.map((artwork) => artwork.backdrop).find(Boolean);
  if (!source)
    return new Response('Image unavailable.', {
      status: 404,
      headers: { 'Cache-Control': 'private, max-age=3600' },
    });
  const url = tmdbArtworkUrl(source, (await getConfig()).cacheTmdbArtwork)!;
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'private, max-age=300' },
  });
}
