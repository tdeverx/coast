import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { media, externalIds, seasons } from '$lib/server/db/schema';
import { traktEntry } from '$lib/sync/trakt-identity';
import type { TraktRecord } from '$lib/providers/trakt/adapter.server';
import { ingestMetadata, importTmdb, getTmdb } from './service';

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
