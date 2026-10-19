import { sql } from 'drizzle-orm';
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

type IdentityInput = {mediaId: string; kind: TraktKind};
/** Read bounded identity batches; results retain input order and missing entries. */
export async function exportIdentities(items: readonly IdentityInput[]): Promise<TraktIds[]> {
  const result: TraktIds[] = [];
  for(let offset=0;offset<items.length;offset+=500) {
    const batch=items.slice(offset,offset+500);
    const rows=(await getDb().execute(sql`select requested.ordinal, mapping.provider, mapping.external_id as "externalId"
      from (values ${sql.join(batch.map((item,ordinal)=>sql`(${ordinal}::integer,${item.mediaId}::uuid,${item.kind}::text)`),sql`,`)}) requested(ordinal,media_id,kind)
      join ${externalIds} mapping on mapping.media_id=requested.media_id and mapping.media_kind=requested.kind`
    )) as {ordinal:number;provider:string;externalId:string}[];
    const grouped=new Map<number,typeof rows>();
    for(const row of rows){const list=grouped.get(row.ordinal)??[];list.push(row);grouped.set(row.ordinal,list);}
    for(let ordinal=0;ordinal<batch.length;ordinal++)result.push(identityMappings(grouped.get(ordinal)??[]));
  }
  return result;
}
export async function exportIdentity(mediaId: string, kind: TraktKind): Promise<TraktIds> {
  return (await exportIdentities([{mediaId,kind}]))[0];
}
function identityMappings(mappings: {provider:string;externalId:string}[]): TraktIds {
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
