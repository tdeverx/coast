import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { externalIds } from '$lib/server/db/schema';
import type { TraktRecord } from '$lib/providers/trakt/adapter.server';

/** A season/episode record also includes its show; the leaf determines identity. */
export function traktEntry(record: TraktRecord) {
  if (record.movie) return { kind: 'movie' as const, item: record.movie };
  if (record.episode) return { kind: 'episode' as const, item: record.episode };
  if (record.season) return { kind: 'season' as const, item: record.season };
  if (record.show) return { kind: 'show' as const, item: record.show };
  return null;
}

export type TraktKind = 'movie' | 'show' | 'season' | 'episode';

export type TraktIds = Record<string, string | number>;

export const traktPlurals = {
  movie: 'movies',
  show: 'shows',
  season: 'seasons',
  episode: 'episodes',
} as const;

export async function exportIdentity(mediaId: string, kind: TraktKind): Promise<TraktIds> {
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
