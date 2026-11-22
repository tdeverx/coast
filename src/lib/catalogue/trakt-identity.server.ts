import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { media, externalIds, episodes, seasons } from '#lib/server/db/schema.js';
import { traktEntry } from '#lib/sync/trakt-identity.server.js';
import type { TraktRecord } from '#lib/providers/trakt/adapter.server.js';
import { CatalogueIdentityConflict, ingestMetadata, importTmdb } from './service.server';
import { getTmdb } from '#lib/providers/tmdb/connection.server.js';
import { anthologyTmdb, anthologyTrakt, isAnthologyRoot } from './anthology.server.js';
import { providerCache } from '#lib/server/utils/provider-cache.js';

const checkedAnthologies = providerCache<boolean>(128, 5 * 60_000);

async function groupedTraktItem(record: TraktRecord, seasonId: string, boundSeason?: string | null, native?: string | null) {
  const parent = record.show!;
  if (boundSeason && boundSeason !== seasonId) throw new CatalogueIdentityConflict();
  if (!boundSeason)
    await getDb().insert(externalIds).values({
      mediaId: seasonId, provider: anthologyTrakt, externalId: String(parent.ids.trakt), mediaKind: 'season',
    }).onConflictDoNothing();
  if (!record.episode) {
    if (record.season && record.season.number !== 1) return null;
    const [season] = await getDb().select().from(media).where(eq(media.id, seasonId));
    return season ?? null;
  }
  const episode = record.episode;
  const tmdbId = episode.ids.tmdb ? String(episode.ids.tmdb) : null;
  // A native season number is shared by every story. Resolve a known episode ID
  // within the matched season, including when the provider changes its order.
  const identities = Object.entries(episode.ids).filter(([provider, id]) =>
    ['tmdb', 'tvdb', 'imdb', 'trakt'].includes(provider) && id != null);
  const targets = await getDb().selectDistinct({ item: media, tmdbOwner: sql<string | null>`(
    select alias.media_id from external_ids alias
    where (alias.provider,alias.media_kind,alias.external_id)=('tmdb','episode',${tmdbId})
  )` }).from(episodes)
    .innerJoin(media, eq(media.id, episodes.mediaId))
    .innerJoin(externalIds, and(eq(externalIds.mediaId, episodes.mediaId), eq(externalIds.mediaKind, 'episode')))
    .where(and(eq(episodes.seasonId, seasonId), or(...identities.map(([provider, id]) =>
      and(eq(externalIds.provider, provider), eq(externalIds.externalId, String(id)))))));
  const [target] = targets;
  if (!target || targets.length !== 1) throw new CatalogueIdentityConflict();
  if (target.tmdbOwner && target.tmdbOwner !== target.item.id) throw new CatalogueIdentityConflict();
  if (tmdbId && !target.tmdbOwner) {
    const [added] = await getDb().insert(externalIds).values({
      mediaId: target.item.id, provider: 'tmdb', externalId: tmdbId, mediaKind: 'episode',
    }).onConflictDoNothing().returning({ id: externalIds.id });
    if (!added) {
      const [alias] = await getDb().select({ id: externalIds.mediaId }).from(externalIds)
        .where(and(eq(externalIds.provider, 'tmdb'), eq(externalIds.externalId, tmdbId), eq(externalIds.mediaKind, 'episode')));
      if (alias?.id !== target.item.id) throw new CatalogueIdentityConflict();
    }
  }
  if (!native)
    await getDb().insert(externalIds).values({
      mediaId: target.item.id, provider: 'trakt', externalId: String(episode.ids.trakt), mediaKind: 'episode',
    }).onConflictDoNothing();
  return target.item;
}

/** Bind only the Trakt alias. A verified TMDB episode in the same TMDB show
 * can take precedence over a numbering scheme from another provider. */
async function bindTraktEpisodeByTmdb(
  showId: string,
  show: NonNullable<TraktRecord['show']>,
  episode: NonNullable<TraktRecord['episode']>
) {
  if (!show.ids.tmdb || !episode.ids.tmdb) return null;
  const traktId = String(episode.ids.trakt);
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tmdb:episode:${episode.ids.tmdb}`},0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trakt:episode:${traktId}`},0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`show:${showId}`},0))`);
    const [anchor] = await tx.select({ item: media })
      .from(episodes).innerJoin(media, eq(media.id, episodes.mediaId))
      .innerJoin(externalIds, and(eq(externalIds.mediaId, episodes.mediaId), eq(externalIds.provider, 'tmdb'),
        eq(externalIds.mediaKind, 'episode'), eq(externalIds.externalId, String(episode.ids.tmdb))))
      .where(and(eq(episodes.showId, showId),
        sql`((${episodes.seasonNumber}=${episode.season} and ${episodes.episodeNumber}=${episode.number}) or exists (
          select 1 from metadata_snapshots snapshot where snapshot.media_id=${episodes.mediaId} and snapshot.provider='tmdb'
            and snapshot.raw->>'externalId'=${String(episode.ids.tmdb)}))`,
        sql`exists (select 1 from external_ids parent where parent.media_id=${showId} and parent.provider='tmdb' and parent.media_kind='show' and parent.external_id=${String(show.ids.tmdb)})`));
    if (!anchor) return null;
    const [bound] = await tx.insert(externalIds)
      .values({ mediaId: anchor.item.id, provider: 'trakt', externalId: traktId, mediaKind: 'episode' })
      .onConflictDoNothing().returning({ id: externalIds.id });
    if (bound) return anchor.item;
    const [existing] = await tx.select({ mediaId: externalIds.mediaId }).from(externalIds)
      .where(and(eq(externalIds.provider, 'trakt'), eq(externalIds.externalId, traktId), eq(externalIds.mediaKind, 'episode')));
    return existing?.mediaId === anchor.item.id ? anchor.item : null;
  });
}

export async function resolveTrakt(
  record: TraktRecord
): Promise<typeof media.$inferSelect | null> {
  const entry = traktEntry(record);
  if (!entry) return null;
  const { item: primary, kind } = entry;
  const sourceId = record.show?.ids.tmdb ? String(record.show.ids.tmdb) : null;
  const traktTvdbId = record.show?.ids.tvdb ?? undefined;
  const storyTraktId = record.show ? String(record.show.ids.trakt) : null;
  const [binding] = await getDb().execute<{ native: string | null; season: string | null; traktSeason: string | null; legacy: string | null }>(sql`
    select
      (select x.media_id from external_ids x
        where (x.provider,x.external_id,x.media_kind)=('trakt',${String(primary.ids.trakt)},${kind})) as native,
      (select x.media_id from external_ids x where (x.provider,x.external_id,x.media_kind)=(${anthologyTmdb},${sourceId},'season')) as season,
      (select x.media_id from external_ids x where (x.provider,x.external_id,x.media_kind)=(${anthologyTrakt},${storyTraktId},'season')) as "traktSeason",
      (select root.media_id from external_ids root where (root.provider,root.external_id,root.media_kind)=('tmdb',${sourceId},'show')
        and exists (select 1 from external_ids sibling where sibling.media_id=root.media_id
          and sibling.provider='tmdb' and sibling.media_kind='show' and sibling.external_id<>root.external_id)) as legacy`);
  const grouped = binding.season ?? binding.traktSeason;
  if (grouped) return groupedTraktItem(record, grouped, binding.traktSeason, binding.native);
  if (binding.legacy && sourceId)
    await checkedAnthologies(`${binding.legacy}:${sourceId}:${traktTvdbId ?? ''}`, async () => {
      if (!(await getTmdb())) return false;
      await importTmdb('show', sourceId, { includeEpisodes: false, includeRecommendations: false, traktTvdbId });
      return true;
    });
  if (binding.legacy && sourceId) {
    const [story] = await getDb().select({ id: externalIds.mediaId }).from(externalIds).where(and(
      eq(externalIds.provider, anthologyTmdb), eq(externalIds.externalId, sourceId), eq(externalIds.mediaKind, 'season')
    ));
    if (story) return groupedTraktItem(record, story.id, null, binding.native);
    // A provisional series match cannot supply episode ownership by number.
    if (record.episode || record.season) throw new CatalogueIdentityConflict();
    if ((await getDb().execute(sql`select 1 where ${isAnthologyRoot(binding.legacy)}`)).length) return null;
  }
  if (binding.native) {
    const [item] = await getDb().select().from(media).where(and(eq(media.id, binding.native),
      kind === 'show' ? sql`not ${isAnthologyRoot(media.id)}` : undefined));
    return item;
  }
  const ids = Object.fromEntries(
    Object.entries(primary.ids)
      .filter(([key, val]) => key !== 'slug' && val !== null && val !== undefined)
      .map(([key, val]) => [key, String(val)])
  );
  if (kind === 'movie' || kind === 'show') {
    if (primary.ids.tmdb && (await getTmdb())) {
      const item = await importTmdb(kind, String(primary.ids.tmdb), {
        includeEpisodes: false, includeRecommendations: false, traktTvdbId,
      });
      if (kind === 'show') {
        const [story] = await getDb().select({ id: externalIds.mediaId }).from(externalIds).where(and(
          eq(externalIds.provider, anthologyTmdb), eq(externalIds.externalId, String(primary.ids.tmdb)), eq(externalIds.mediaKind, 'season')
        ));
        // Nested callers still need the parent show for legacy episode lookups.
        if (story) return groupedTraktItem(record, story.id);
      }
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
  if (show.kind === 'season') return groupedTraktItem(record, show.id);
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
  try {
    return await ingestMetadata(
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
  } catch (error) {
    if (!(error instanceof CatalogueIdentityConflict)) throw error;
    const episode = await bindTraktEpisodeByTmdb(show.id, record.show, record.episode);
    if (episode) return episode;
    throw error;
  }
}
