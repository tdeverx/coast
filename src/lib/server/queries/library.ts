import {librarySegmentCondition} from './library-segments';
import {librarySortValues,librarySegmentValues} from '#lib/library.js';
import {libraryOrder} from './library-order';
import { getFeatureConfig } from '#lib/server/features.js';
import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch.server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import { withReadCancellation } from '../db/read-cancellation';
import * as s from '../db/schema';
import { mediaViews, hasPermittedMediaSource, hasPermittedWorkSource } from './media';
import { pageNumberSchema, PAGE_SIZE, pagination, requestedPageInterval } from './pagination';

import { pageInterval } from '#lib/page-window.js';

const uuidSchema = v.pipe(v.string(), v.uuid());

export const libraryOptionsSchema = v.object({
  segment:v.optional(v.picklist(librarySegmentValues),'all'),
  sort: v.optional(v.picklist(librarySortValues), 'default'),
  page: v.optional(pageNumberSchema, 1),
  genre: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
  kind: v.optional(v.picklist(['all', 'movie', 'show','collection']), 'all'),
  scope: v.optional(v.picklist(['available', 'all']), 'available'),
  source: v.optional(v.union([v.literal('all'), uuidSchema]), 'all'),
  tracking: v.optional(v.picklist(['all', 'watched', 'unwatched', 'progress', 'dropped']), 'all'),
});

export function libraryTrackingCondition(
  userId: string,
  tracking: v.InferOutput<typeof libraryOptionsSchema>['tracking'],
  reference={id:sql`${s.media.id}`,kind:sql`${s.media.kind}`,state:sql`tracking_state`,dropped:sql`${s.trackingState.dropped}`}
) {
  const child = rewatchFields(userId, sql`e.media_id`, sql`child`);
  const current = rewatchFields(userId, reference.id, reference.state);
  const complete = sql`case when ${reference.kind} = 'show' then
    exists (select 1 from episodes e where e.show_id=${reference.id} and not e.is_special)
    and not exists (select 1 from episodes e left join tracking_state child on child.media_id=e.media_id and child.user_id=${userId}
      where e.show_id=${reference.id} and not e.is_special and not (${child.watched}))
    else ${current.watched} end`;
  const started = sql`case when ${reference.kind} = 'show' then
    exists (select 1 from episodes e join tracking_state child on child.media_id=e.media_id and child.user_id=${userId}
      where e.show_id=${reference.id} and not e.is_special and (${child.watched} or (${child.progress}>0 and not child.dropped)))
    else ${current.progress}>0 end`;
  return tracking === 'watched'
    ? sql`(${complete}) and not coalesce(${reference.dropped},false)`
    : tracking === 'unwatched'
      ? sql`not (${complete})`
      : tracking === 'dropped'
        ? sql`${reference.dropped}=true`
        : tracking === 'progress'
          ? sql`case
              when coalesce(${reference.dropped},false) then false
              when ((${started}) or ${rewatchBoundary(userId, sql`${reference.id}`)} is not null) then not (${complete})
              else false end`
          : undefined;
}

/** Share eligibility/count across a bounded range; preserve native 60-title hydration pages. */
export async function libraryData(userId: string, rawOptions: unknown = {}, firstPage?: number, signal?: AbortSignal) {
  return withReadCancellation(signal,()=>libraryRead(userId,rawOptions,firstPage,signal));
}
async function libraryRead(userId:string,rawOptions:unknown,firstPage?:number,signal?:AbortSignal){
  signal?.throwIfAborted();
  v.parse(uuidSchema, userId);
  const input = v.parse(libraryOptionsSchema, rawOptions);
  const interval = requestedPageInterval(input.page, firstPage);
  const pageSize = PAGE_SIZE;
  const permittedSource = input.kind==='collection'?hasPermittedWorkSource(userId):hasPermittedMediaSource(userId, input.source);
  const tracking = libraryTrackingCondition(userId, input.tracking);
  const config = await getFeatureConfig(userId);
  // Match the same override/provider precedence used by the cards, before pagination.
  const genre = input.genre
    ? sql`exists(select 1 from unnest(coalesce(
    (select genres from metadata_overrides where media_id=${s.media.id}),
    (select genres from metadata_snapshots where media_id=${s.media.id} and genres is not null
      and (${config.metadataSource !== 'tmdb-only'} or provider='tmdb')
      order by case provider when 'jellyfin' then 0 when 'tmdb' then 1 else 2 end, updated_at desc limit 1),
    ${s.media.genres})) g where lower(g)=lower(${input.genre}))`
    : undefined;
  const segment=await librarySegmentCondition(userId,userId,input.segment,s.media.id,'screen');
  signal?.throwIfAborted();
  const where = and(
    segment,
    input.kind === 'all' ? inArray(s.media.kind, ['movie', 'show']) : eq(s.media.kind, input.kind),
    permittedSource,
    tracking,
    genre
  );
  const join = and(eq(s.trackingState.mediaId, s.media.id), eq(s.trackingState.userId, userId));
  const db = getDb();
  // Share membership and count/page snapshot; hydrate only the selected titles.
  const order=libraryOrder(input.sort,{title:sql`title`,added:sql`created_at`,id:sql`id`},sql`updated_at desc,id`);
  const [result] = (await db.execute(sql`
    with eligible as materialized (
      select ${s.media.id} as id, ${s.media.updatedAt} as updated_at, ${s.media.createdAt} as created_at, ${s.media.title} as title
      from ${s.media} join ${s.works} on ${s.works.id}=${s.media.id} left join ${s.trackingState} on ${join} where ${where}
    ), total as (select count(*)::int as total from eligible)
    select total, coalesce((select jsonb_agg(id order by ${order})
      from (select * from eligible order by ${order} limit ${interval ? sql`(least(${interval.lastPage}, greatest(1, ceil(total::numeric / ${pageSize})::int))
          - least(${interval.firstPage}, greatest(1, ceil(total::numeric / ${pageSize})::int)) + 1) * ${pageSize}` : sql`${pageSize}`}
        offset (least(${interval?.firstPage ?? input.page}, greatest(1, ceil(total::numeric / ${pageSize})::int)) - 1) * ${pageSize}) page),
      '[]'::jsonb) as ids from total
  `)) as { total: number; ids: string[] }[];
  const total = result.total;
  const { page, pages } = pagination(total, input.page);
  const bounds = pageInterval(pages, page, interval?.firstPage);
  const items: Awaited<ReturnType<typeof mediaViews>> = [], counts: number[] = [];
  for (let number = bounds.firstPage; number <= page; number++) {
    signal?.throwIfAborted();
    const ids = result.ids.slice((number - bounds.firstPage) * pageSize, (number - bounds.firstPage + 1) * pageSize);
    const views = new Map((await mediaViews(userId, { ids, limit: pageSize })).map(item => [item.id, item]));
    signal?.throwIfAborted();
    const selected = ids.flatMap(id => views.has(id) ? [views.get(id)!] : []);
    items.push(...selected); counts.push(selected.length);
  }
  return {
    items,
    ...(interval ? { range: { ...bounds, counts } } : {}),
    total,
    page,
    pages,
    pageSize,
    filters: {
      sort: input.sort,
      genre: input.genre,
      kind: input.kind,
      scope: input.scope,
      source: input.source,
      tracking: input.tracking,
    },
  };
}
