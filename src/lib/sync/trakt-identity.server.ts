import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { externalIds } from '#lib/server/db/schema.js';
import type { TraktAdapter, TraktRecord } from '#lib/providers/trakt/adapter.server.js';
import { anthologyTmdb, anthologyTrakt, isAnthologyRoot } from '#lib/catalogue/anthology.server.js';

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
type TraktTarget = { kind: TraktKind; ids: TraktIds };
/** Read bounded identity batches; results retain input order and missing entries. */
export async function exportTargets(items: readonly IdentityInput[], requireUniqueIds = false): Promise<(TraktTarget | null)[]> {
  const result: (TraktTarget | null)[] = [];
  for(let offset=0;offset<items.length;offset+=500) {
    const batch=items.slice(offset,offset+500);
    const rows=(await getDb().execute(sql`select requested.ordinal, mapping.provider, mapping.external_id as "externalId",
      case when requested.kind='show' then ${isAnthologyRoot(sql`requested.media_id`)} else false end as "localOnly",
      case when requested.kind='episode' then exists (
        select 1 from episodes episode join external_ids x on x.media_id=episode.season_id and x.provider=${anthologyTmdb}
        where episode.media_id=requested.media_id
      ) else false end as "storyEpisode"
      from (values ${sql.join(batch.map((item,ordinal)=>sql`(${ordinal}::integer,${item.mediaId}::uuid,${item.kind}::text)`),sql`,`)}) requested(ordinal,media_id,kind)
      left join ${externalIds} mapping on mapping.media_id=requested.media_id and mapping.media_kind=requested.kind`
    )) as {ordinal:number;provider:string;externalId:string;localOnly:boolean;storyEpisode:boolean}[];
    const grouped=new Map<number,typeof rows>();
    for(const row of rows){const list=grouped.get(row.ordinal)??[];list.push(row);grouped.set(row.ordinal,list);}
    for (let ordinal=0; ordinal<batch.length; ordinal++) {
      const mappings = grouped.get(ordinal) ?? [];
      const item = batch[ordinal];
      if (mappings[0]?.localOnly) {
        result.push(null);
        continue;
      }
      const story = mappings.find(mapping => mapping.provider === anthologyTmdb);
      if (story) {
        const trakt = mappings.find(mapping => mapping.provider === anthologyTrakt);
        result.push({ kind: 'show', ids: identityMappings([
          { provider: 'tmdb', externalId: story.externalId },
          ...(trakt ? [{ provider: 'trakt', externalId: trakt.externalId }] : []),
        ]) });
        continue;
      }
      const relevant = mappings[0]?.storyEpisode ? mappings.filter(mapping => mapping.provider === 'tmdb') : mappings;
      result.push({ kind: item.kind, ids: identityMappings(relevant, requireUniqueIds) });
    }
  }
  return result;
}
export async function exportIdentity(mediaId: string, kind: TraktKind): Promise<TraktIds> {
  return (await exportTarget(mediaId, kind))?.ids ?? {};
}
export async function exportTarget(mediaId: string, kind: TraktKind) {
  return (await exportTargets([{mediaId,kind}]))[0];
}

export async function resolveTraktHistoryTarget(adapter: TraktAdapter, mediaId: string, kind: 'movie' | 'episode') {
  const [target] = await exportTargets([{ mediaId, kind }], true);
  if (target?.kind !== kind) return;
  const id = await adapter.resolveExactId(kind, target.ids);
  if (!id) return;
  if (target.ids.trakt !== id) {
    const [otherOwner] = await getDb().select({ id: externalIds.id }).from(externalIds).where(and(
      eq(externalIds.provider, 'trakt'),
      eq(externalIds.mediaKind, kind),
      eq(externalIds.externalId, String(id)),
      ne(externalIds.mediaId, mediaId)
    ));
    if (otherOwner) return;
  }
  return { kind, id };
}

export async function resolveTraktShowTarget(adapter: TraktAdapter, mediaId: string, kind: 'show' | 'season') {
  const [target] = await exportTargets([{ mediaId, kind }], true);
  if (target?.kind !== 'show') return;
  const id = await adapter.resolveExactId('show', target.ids);
  if (!id) return;
  const owners = await getDb().select({ mediaId: externalIds.mediaId })
    .from(externalIds).where(and(sql`(${externalIds.provider},${externalIds.mediaKind}) in
      (('trakt','show'),(${anthologyTrakt},'season'))`, eq(externalIds.externalId, String(id))));
  if (owners.some(owner => owner.mediaId !== mediaId)) return;
  return id;
}

function identityMappings(mappings: {provider:string;externalId:string}[], requireUniqueIds = false): TraktIds {
  const entries = mappings
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
    ] as const);
  const ids = Object.fromEntries(entries);
  if (requireUniqueIds && entries.some(([provider, id]) => ids[provider] !== id)) return {};
  return ids;
}
