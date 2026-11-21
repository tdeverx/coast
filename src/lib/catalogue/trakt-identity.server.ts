import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { media, externalIds, episodes, seasons } from '#lib/server/db/schema.js';
import { traktEntry } from '#lib/sync/trakt-identity.server.js';
import type { TraktRecord } from '#lib/providers/trakt/adapter.server.js';
import { CatalogueIdentityConflict, ingestMetadata, importTmdb } from './service.server';
import { getTmdb } from '#lib/providers/tmdb/connection.server.js';

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
