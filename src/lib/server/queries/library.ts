import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getConfig } from '../config';
import { getDb } from '../db';
import * as s from '../db/schema';
import { mediaViews, hasPermittedMediaSource } from './media';
import { pageNumberSchema, PAGE_SIZE, pagination } from './pagination';

const uuidSchema = v.pipe(v.string(), v.uuid());

export const libraryOptionsSchema = v.object({
  page: v.optional(pageNumberSchema, 1),
  genre: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
  kind: v.optional(v.picklist(['all', 'movie', 'show']), 'all'),
  scope: v.optional(v.picklist(['available', 'all']), 'available'),
  source: v.optional(v.union([v.literal('all'), uuidSchema]), 'all'),
  tracking: v.optional(v.picklist(['all', 'watched', 'unwatched', 'progress', 'dropped']), 'all'),
});

export function libraryTrackingCondition(
  userId: string,
  tracking: v.InferOutput<typeof libraryOptionsSchema>['tracking']
) {
  const child = rewatchFields(userId, sql`e.media_id`, sql`child`);
  const current = rewatchFields(userId, sql`${s.media.id}`);
  const complete = sql`case when ${s.media.kind} = 'show' then
    exists (select 1 from episodes e where e.show_id=${s.media.id} and not e.is_special)
    and not exists (select 1 from episodes e left join tracking_state child on child.media_id=e.media_id and child.user_id=${userId}
      where e.show_id=${s.media.id} and not e.is_special and not (${child.watched}))
    else ${current.watched} end`;
  const started = sql`case when ${s.media.kind} = 'show' then
    exists (select 1 from episodes e join tracking_state child on child.media_id=e.media_id and child.user_id=${userId}
      where e.show_id=${s.media.id} and not e.is_special and (${child.watched} or (${child.progress}>0 and not child.dropped)))
    else ${current.progress}>0 end`;
  return tracking === 'watched'
    ? sql`(${complete}) and not coalesce(${s.trackingState.dropped},false)`
    : tracking === 'unwatched'
      ? sql`not (${complete})`
      : tracking === 'dropped'
        ? eq(s.trackingState.dropped, true)
        : tracking === 'progress'
          ? sql`((${started}) or ${rewatchBoundary(userId, sql`${s.media.id}`)} is not null) and not (${complete}) and not coalesce(${s.trackingState.dropped},false)`
          : undefined;
}

/** Filter and count the catalogue before paging, then resolve metadata for at most 60 titles. */
export async function libraryData(userId: string, rawOptions: unknown = {}) {
  v.parse(uuidSchema, userId);
  const input = v.parse(libraryOptionsSchema, rawOptions);
  const pageSize = PAGE_SIZE;
  const permittedSource = hasPermittedMediaSource(userId, input.source);
  const tracking = libraryTrackingCondition(userId, input.tracking);
  const config = await getConfig();
  // Match the same override/provider precedence used by the cards, before pagination.
  const genre = input.genre
    ? sql`exists(select 1 from unnest(coalesce(
    (select genres from metadata_overrides where media_id=${s.media.id}),
    (select genres from metadata_snapshots where media_id=${s.media.id} and genres is not null
      and (${config.metadataSource !== 'tmdb-only'} or provider='tmdb')
      order by case provider when 'jellyfin' then 0 when 'tmdb' then 1 else 2 end, updated_at desc limit 1),
    ${s.media.genres})) g where lower(g)=lower(${input.genre}))`
    : undefined;
  const where = and(
    input.kind === 'all' ? inArray(s.media.kind, ['movie', 'show']) : eq(s.media.kind, input.kind),
    permittedSource,
    tracking,
    genre
  );
  const join = and(eq(s.trackingState.mediaId, s.media.id), eq(s.trackingState.userId, userId));
  const db = getDb();
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(s.media)
    .leftJoin(s.trackingState, join)
    .where(where);
  const total = count.total;
  const { page, pages } = pagination(total, input.page);
  const selected = await db
    .select({ id: s.media.id })
    .from(s.media)
    .leftJoin(s.trackingState, join)
    .where(where)
    .orderBy(desc(s.media.updatedAt), asc(s.media.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const views = new Map(
    (await mediaViews(userId, { ids: selected.map((row) => row.id), limit: pageSize })).map(
      (item) => [item.id, item]
    )
  );
  const items = selected.flatMap((row) => (views.get(row.id) ? [views.get(row.id)!] : []));
  return {
    items,
    total,
    page,
    pages,
    pageSize,
    filters: {
      genre: input.genre,
      kind: input.kind,
      scope: input.scope,
      source: input.source,
      tracking: input.tracking,
    },
  };
}
