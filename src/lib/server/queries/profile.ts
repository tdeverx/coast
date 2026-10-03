import {profileVisibility,requireVisible} from '$lib/social/privacy.server';
import {workCards} from '$lib/collection/query.server';
import { recordedWatches as watches } from '$lib/core/tracking/recorded-watches';
import { libraryTrackingCondition } from './library';
import { periodStart, type ProfilePeriod } from '$lib/profile/period';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { viewingRecency } from './viewing-recency';
import { mediaViews, hasPermittedMediaSource } from './media';
import { PAGE_SIZE, pageNumberSchema, pagination } from './pagination';
const day = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}$/),
  v.check(
    (value) =>
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    'Choose a valid date.'
  )
);
export const profileOptionsSchema = v.object({
  view: v.optional(v.picklist(['overview', 'history', 'favourites', 'ratings']), 'overview'),
  page: v.optional(pageNumberSchema, 1),
  scope: v.optional(v.picklist(['all', 'available']), 'all'),
  kind: v.optional(v.picklist(['all', 'movie', 'show']), 'all'),
  period: v.optional(v.picklist(['month', 'year', 'all']), 'all'),
  query: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160)), ''),
  activityKind: v.optional(v.picklist(['all', 'movie', 'episode']), 'all'),
  repeats: v.optional(v.boolean(), false),
  rating: v.optional(
    v.pipe(
      v.number(),
      v.minValue(0.5),
      v.maxValue(5),
      v.check((n) => Number.isInteger(n * 2))
    )
  ),
  genre: v.optional(v.pipe(v.string(), v.maxLength(120))),
  from: v.optional(day),
  to: v.optional(day),
});
function genreRows(history: ReturnType<typeof watches>) {
  return sql`select distinct h.media_id, genre from (select distinct media_id from (${history}) events) h
    left join episodes ep on ep.media_id=h.media_id join media m on m.id=coalesce(ep.show_id,h.media_id)
    left join metadata_overrides o on o.media_id=m.id
    left join lateral (select genres from metadata_snapshots where media_id=m.id and cardinality(genres)>0 order by updated_at desc limit 1) snapshot on true
    cross join lateral unnest(coalesce(o.genres,nullif(m.genres,'{}'),snapshot.genres,'{}'::text[])) genre`;
}
function periodHistory(userId: string, period: ProfilePeriod, now = new Date()) {
  const start = periodStart(period, now);
  return sql`select * from (${watches(userId)}) watches where ${start ? sql`occurred_at_known and occurred_at >= (${start}::date::timestamp at time zone 'UTC')` : sql`true`} and occurred_at <= ${now.toISOString()}::timestamptz`;
}
export async function profileData(
  userId: string,
  input: unknown = {},
  now = new Date(),
  viewerId: string | null = userId
) {
  const options = v.parse(profileOptionsSchema, input);
  const visibility=await profileVisibility(userId,viewerId);
  if(!Object.values(visibility).some(Boolean))throw new (await import('../security/errors')).AppError(404,'Profile not found.');
  if(options.view!=='overview')await requireVisible(userId,viewerId,options.view==='history'?'activity':options.view,'screen');
  const db = getDb();
  const [user] = await db
    .select({ settings: s.users.settings })
    .from(s.users)
    .where(eq(s.users.id, userId));
  const profile = visibility.details ? { ...user?.settings.profile } : {};
  if(visibility.details)profile.backgroundMode??=profile.backgroundMediaId?'fixed':'activity';
  if (!visibility.favourites) {
    delete profile.favouriteOrder;
    delete profile.pinnedFavourites;
  }
  const periodEvents = sql`select * from (${periodHistory(userId, options.period, now)}) h where ${visibility.activity}`;
  const genreMatches = genreRows(periodEvents);
  const genreFilter = !options.genre
    ? sql`true`
    : options.genre === '__other__'
      ? sql`media_id in (select media_id from (${genreMatches}) g where genre not in (select genre from (${genreMatches}) all_genres group by genre order by count(*) desc,genre limit 6))`
      : sql`media_id in (select media_id from (${genreMatches}) g where genre = ${options.genre})`;
  const query = options.query.replace(/[\\%_]/g, '\\$&');
  const matching = options.query
    ? sql`media_id in (select m.id from media m left join episodes ep on ep.media_id=m.id left join media series on series.id=ep.show_id where m.title ilike ${`%${query}%`} or series.title ilike ${`%${query}%`})`
    : sql`true`;
  const history = sql`select * from (${periodEvents}) p where ${genreFilter} and ${matching} and ${options.activityKind === 'all' ? sql`true` : sql`kind=${options.activityKind}`} and ${options.repeats ? sql`rewatched` : sql`true`}`;
  const ratingFilter = and(
    sql`${visibility.ratings}`,
    eq(s.ratings.userId, userId),
    sql`${s.ratings.updatedAt} <= ${now.toISOString()}::timestamptz`,
    options.period === 'all'
      ? undefined
      : sql`${s.ratings.updatedAt} >= (${periodStart(options.period, now)}::date::timestamp at time zone 'UTC')`,
    options.rating === undefined ? undefined : eq(s.ratings.value, options.rating)
  );
  const dates = sql`${options.from || options.to ? sql`occurred_at_known` : sql`true`} and ${options.from ? sql`occurred_at >= (${options.from}::date::timestamp at time zone 'UTC')` : sql`true`} and ${options.to ? sql`occurred_at < ((${options.to}::date + interval '1 day') at time zone 'UTC')` : sql`true`}`;
  const favouriteFilter = and(
    eq(s.trackingState.userId, userId),
    sql`${visibility.favourites}`,
    eq(s.trackingState.favourite, true),
    options.scope === 'available' ? viewerId ? hasPermittedMediaSource(viewerId) : sql`false` : undefined,
    options.kind === 'movie'
      ? eq(s.media.kind, 'movie')
      : options.kind === 'show'
        ? sql`${s.media.kind} in ('show','season','episode')`
        : undefined
  );
  const [[counts], [rated], historyCounts, [favouriteCount]] = await Promise.all([
    db
      .select({
        favourites: sql<number>`count(*) filter (where ${s.trackingState.favourite})::int`,
      })
      .from(s.trackingState)
      .where(and(eq(s.trackingState.userId, userId),sql`${visibility.favourites}`)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.ratings)
      .where(ratingFilter),
    db.execute<{
      total: number;
      unique: number;
      movies: number;
      episodes: number;
      filtered: number;
    }>(
      sql`select count(*)::int as total, count(distinct media_id)::int as unique, count(distinct media_id) filter(where kind='movie')::int as movies, count(distinct media_id) filter(where kind='episode')::int as episodes, count(*) filter(where ${dates})::int as filtered from (${history}) h`
    ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.trackingState)
      .innerJoin(s.media, eq(s.media.id, s.trackingState.mediaId))
      .where(favouriteFilter),
  ]);
  const total =
    options.view === 'ratings'
      ? rated.count
      : options.view === 'favourites'
        ? favouriteCount.count
        : historyCounts[0].filtered;
  const { page, pages } = pagination(total, options.page);
  const limit = PAGE_SIZE;
  const offset = options.view === 'overview' ? 0 : (page - 1) * PAGE_SIZE;
  const ordered = (ids: string[]) =>
    ids.length
      ? sql`array[${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `
        )}]`
      : sql`array[]::uuid[]`;
  const [events, favourites] = await Promise.all([
    options.view !== 'history'
      ? []
      : db.execute<{
          eventId: string;
          id: string;
          watchedAt: Date;
          source: string;
          rewatched: boolean;
        }>(
          sql`select event_id as "eventId", media_id as id, occurred_at as "watchedAt", source, rewatched, occurred_at_known as "dateKnown", edition_id as "editionId" from (${history}) h where ${dates} order by occurred_at_known desc, occurred_at desc, event_id desc limit ${limit} offset ${offset}`
        ),
    ['history', 'ratings'].includes(options.view)
      ? []
      : db
          .select({ id: s.trackingState.mediaId })
          .from(s.trackingState)
          .innerJoin(s.media, eq(s.media.id, s.trackingState.mediaId))
          .where(favouriteFilter)
          .orderBy(
            sql`case when ${s.trackingState.mediaId} = any(${ordered(profile.pinnedFavourites ?? [])}) then 0 else 1 end`,
            sql`coalesce(array_position(${ordered(profile.favouriteOrder ?? [])}, ${s.trackingState.mediaId}), 2147483647)`,
            desc(s.trackingState.updatedAt),
            s.trackingState.mediaId
          )
          .limit(options.view === 'overview' ? 20 : PAGE_SIZE)
          .offset(options.view === 'favourites' ? offset : 0),
  ]);
  const ratedItems =
    options.view === 'ratings'
      ? await db
          .select({ id: s.ratings.mediaId })
          .from(s.ratings)
          .where(ratingFilter)
          .orderBy(desc(s.ratings.updatedAt), s.ratings.mediaId)
          .limit(PAGE_SIZE)
          .offset(offset)
      : [];
  const [featuredState] = profile.featuredMediaId
    ? await db
        .select({ id: s.trackingState.mediaId })
        .from(s.trackingState)
        .where(
          and(
            eq(s.trackingState.userId, userId),
            eq(s.trackingState.mediaId, profile.featuredMediaId),
            eq(s.trackingState.favourite, true)
          )
        )
    : [];
  const ids = [
    ...new Set(
      [...events, ...favourites, ...ratedItems]
        .map((row) => row.id)
        .concat(profile.backgroundMediaId ? [profile.backgroundMediaId] : [])
        .concat(featuredState ? [featuredState.id] : [])
    ),
  ];
  const views = await mediaViews(userId, { ids, limit: Math.max(1, ids.length) }, viewerId);
  const showIds = [...new Set(views.flatMap((item) => (item.showId ? [item.showId] : [])))];
  const shows = new Map(
    (await mediaViews(userId, { ids: showIds, limit: Math.max(1, showIds.length) }, viewerId)).map(
      (item) => [item.id, item.title]
    )
  );
  const byId = new Map(
    views.map((item) => [
      item.id,
      item.kind === 'episode'
        ? {
            ...item,
            captionTitle: shows.get(item.showId!) ?? item.title,
            captionSubtitle: `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(item.episodeNumber ?? 0).padStart(2, '0')} · ${item.title}`,
          }
        : item,
    ])
  );
  let activityBackground = null;
  if(profile.backgroundMode==='activity'){
    const latest=await db.execute<{workId:string}>(sql`select a.work_id as "workId" from social_activity a join works w on w.id=a.work_id
      where a.user_id=${userId}::uuid and a.date_known and a.event_kind in ('watch','listen','play','played','session') and a.occurred_at<=${now.toISOString()}::timestamptz
      and social_visible(a.user_id,${viewerId}::uuid,a.section,w.category)
      and (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true'))
      order by a.occurred_at desc,a.id desc limit 1`);
    activityBackground=latest[0]?(await workCards(userId,viewerId,[latest[0].workId]))[0]??null:null;
  }
  return {
    visibility,
    view: options.view,
    page,
    pages,
    total,
    filters: {
      kind: options.kind,
      from: options.from,
      to: options.to,
      genre: options.genre,
      period: options.period,
      query: options.query,
      activityKind: options.activityKind,
      repeats: options.repeats,
      rating: options.rating,
    },
    profile,
    categories:
      historyCounts[0].total || counts.favourites || rated.count ? (['screen'] as const) : [],
    featured: featuredState ? (byId.get(featuredState.id) ?? null) : null,
    ratedTitles: ratedItems.flatMap((row) => (byId.has(row.id) ? [byId.get(row.id)!] : [])),
    background: profile.backgroundMode==='activity'?activityBackground:profile.backgroundMediaId ? (byId.get(profile.backgroundMediaId) ?? null) : null,
    totals: {
      movies: visibility.insights?historyCounts[0].movies:0,
      episodes: visibility.insights?historyCounts[0].episodes:0,
      unique: visibility.insights?historyCounts[0].unique:0,
      watches: visibility.insights?historyCounts[0].total:0,
      favourites: visibility.insights?counts.favourites:0,
      rated: visibility.insights?rated.count:0,
    },
    history: Array.from(events).flatMap((row) =>
      byId.has(row.id)
        ? [
            {
              ...byId.get(row.id)!,
              eventId: row.eventId,
              dateKnown: row.dateKnown,
              activity: {
                id: row.eventId,
                workId: row.id,
                editionId: row.editionId ?? undefined,
                status: 'completed' as const,
                startedAt: null,
                completedAt: row.dateKnown ? new Date(row.watchedAt).toISOString() : null,
                repeat: row.rewatched,
              },
              watchedAt: new Date(row.watchedAt).toISOString(),
              source: row.source,
              rewatched: row.rewatched,
            },
          ]
        : []
    ),
    favourites: favourites.flatMap((row) =>
      byId.has(row.id)
        ? [{ ...byId.get(row.id)!, pinned: (profile.pinnedFavourites ?? []).includes(row.id) }]
        : []
    ),
    today: new Date().toISOString().slice(0, 10),
  };
}
export async function profileActivity(
  userId: string,
  now = new Date(),
  period: ProfilePeriod = 'all',
  viewerId: string | null = userId
) {
  await requireVisible(userId,viewerId,'insights','screen');
  const visibility=await profileVisibility(userId,viewerId);
  const history = sql`select * from (${periodHistory(userId, period, now)}) h where ${visibility.activity}`;
  const previousNow =
    period === 'all' ? undefined : new Date(Date.parse(periodStart(period, now)!) - 1);
  const previousHistory = previousNow ? sql`select * from (${periodHistory(userId,period,previousNow)}) h where ${visibility.activity}` : null;
  const [days, genres, ratings, seasonRows, previousRows] = await Promise.all([
    getDb().execute(
      sql`select to_char(occurred_at at time zone 'UTC','YYYY-MM-DD') as date, count(*) filter(where kind='movie')::int as movies,count(*) filter(where kind='episode')::int as episodes from (${history}) h where occurred_at_known group by 1 order by 1`
    ),
    getDb().execute(
      sql`select genre as name,count(*)::int as count from (${genreRows(history)}) g group by genre order by count desc,genre`
    ),
    getDb()
      .select({ value: s.ratings.value, count: sql<number>`count(*)::int` })
      .from(s.ratings)
      .where(
        and(
          sql`${visibility.ratings}`,
          eq(s.ratings.userId, userId),
          sql`${s.ratings.updatedAt} <= ${now.toISOString()}::timestamptz`,
          period === 'all'
            ? undefined
            : sql`${s.ratings.updatedAt} >= (${periodStart(period, now)}::date::timestamp at time zone 'UTC')`
        )
      )
      .groupBy(s.ratings.value)
      .orderBy(s.ratings.value),
    getDb().execute(sql`select count(*)::int as count from (
      select ep.season_id,max(t.last_watched_at) as completed_at from episodes ep
      join tracking_state t on t.media_id=ep.media_id and t.user_id=${userId}
      where ep.season_id is not null and not ep.is_special
      group by ep.season_id having bool_and(t.watched) and bool_and(t.last_watched_at is not null)
      and count(*)=(select count(*) from episodes all_ep where all_ep.season_id=ep.season_id and not all_ep.is_special)
    ) seasons where ${visibility.activity} and completed_at<=${now.toISOString()}::timestamptz and ${period === 'all' ? sql`true` : sql`completed_at>=(${periodStart(period, now)}::date::timestamp at time zone 'UTC')`}`),
    previousHistory
      ? getDb().execute(
          sql`select count(*)::int as count from (${previousHistory}) p where occurred_at_known`
        )
      : Promise.resolve([{ count: 0 }]),
  ]);
  const ranked = Array.from(genres, (row) => ({
    name: String(row.name),
    count: Number(row.count),
    filter: String(row.name),
  }));
  const displayed = ranked.slice(0, 6);
  if (ranked.length > 6)
    displayed.push({
      name: 'Other',
      count: ranked.slice(6).reduce((sum, g) => sum + g.count, 0),
      filter: '__other__',
    });
  return {
    days: Array.from(days, (row) => ({
      date: String(row.date),
      movies: Number(row.movies),
      episodes: Number(row.episodes),
    })),
    today: now.toISOString().slice(0, 10),
    genres: displayed,
    completedSeasons: Number(seasonRows[0].count),
    previousCount: period === 'all' ? null : Number(previousRows[0].count),
    ratings,
  };
}

/** Current tracking status is independent of the dated activity journal. */
export async function profileProgress(
  userId: string,
  status: unknown,
  requestedPage: unknown = 1,
  filters: { kind?: 'all' | 'movie' | 'show'; scope?: 'all' | 'available' } = {},
  viewerId = userId
) {
  const selected = v.parse(v.picklist(['watched', 'progress', 'dropped']), status);
  const requested = v.parse(pageNumberSchema, requestedPage);
  const where = and(
    filters.kind === 'movie'
      ? eq(s.media.kind, 'movie')
      : selected === 'dropped'
        ? filters.kind === 'show'
          ? sql`${s.media.kind} in ('show', 'season', 'episode')`
          : sql`${s.media.kind} in ('movie', 'show', 'season', 'episode', 'collection')`
        : filters.kind === 'show'
          ? eq(s.media.kind, 'show')
          : sql`${s.media.kind} in ('movie', 'show')`,
    filters.scope === 'available' ? hasPermittedMediaSource(viewerId) : undefined,
    libraryTrackingCondition(userId, selected)
  );
  const [count] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(s.media)
    .leftJoin(
      s.trackingState,
      and(eq(s.trackingState.mediaId, s.media.id), eq(s.trackingState.userId, userId))
    )
    .where(where);
  const { page, pages } = pagination(count.total, requested);
  const rows = await getDb()
    .select({ id: s.media.id })
    .from(s.media)
    .leftJoin(
      s.trackingState,
      and(eq(s.trackingState.mediaId, s.media.id), eq(s.trackingState.userId, userId))
    )
    .where(where)
    .orderBy(
      selected === 'watched'
        ? sql`${viewingRecency(userId)} desc nulls last`
        : sql`${s.trackingState.updatedAt} desc nulls last`,
      s.media.id
    )
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const hasMore = page < pages;
  const views = new Map(
    (await mediaViews(userId, { ids: rows.map((row) => row.id), limit: PAGE_SIZE }, viewerId)).map(
      (item) => [item.id, item]
    )
  );
  if (selected === 'dropped') {
    for (const item of views.values()) {
      if (item.kind !== 'season' && item.kind !== 'episode') continue;
      const show = item.trackingParents?.find((parent) => parent.kind === 'show');
      const number = String(item.seasonNumber ?? 0).padStart(2, '0');
      item.captionTitle = show?.title ?? item.title;
      item.captionSubtitle =
        item.kind === 'episode'
          ? `S${number}E${String(item.episodeNumber ?? 0).padStart(2, '0')} · ${item.title}`
          : item.title;
    }
  }
  const showIds = rows.filter((row) => views.get(row.id)?.kind === 'show').map((row) => row.id);
  const counts = showIds.length
    ? await getDb().execute<{
        id: string;
        total: number;
        completed: number;
        partial: number;
        fraction: number;
      }>(sql`
    select e.show_id as id, count(*)::int total, count(*) filter(where t.watched)::int completed,
      count(*) filter(where not coalesce(t.watched,false) and not coalesce(t.dropped,false) and t.position_seconds>0)::int partial,
      avg(case when t.watched then 1.0 when not coalesce(t.dropped,false) and t.position_seconds>0 and t.duration_seconds>0
        then least(t.position_seconds/t.duration_seconds,0.999) else 0 end)::float fraction
    from episodes e left join tracking_state t on t.media_id=e.media_id and t.user_id=${userId}
    where e.show_id in (${sql.join(
      showIds.map((id) => sql`${id}::uuid`),
      sql`,`
    )}) and not e.is_special group by e.show_id
  `)
    : [];
  for (const count of counts) {
    const item = views.get(count.id)!;
    if (item.rewatchStartedAt) {
      item.captionTitle = item.title;
      item.captionSubtitle = `Rewatching · ${item.completedEpisodes} / ${item.totalEpisodes} episodes`;
      continue;
    }
    views.set(count.id, {
      ...item,
      watched: count.total > 0 && count.completed === count.total,
      completedEpisodes: count.completed,
      totalEpisodes: count.total,
      trackingProgress: { unit: 'percent', value: count.fraction * 100 },
      status:
        selected === 'dropped' ? 'dropped' : selected === 'watched' ? 'completed' : 'in-progress',
      captionTitle: item.title,
      captionSubtitle: `${count.completed} / ${count.total} episodes${count.partial ? ` · ${count.partial} started` : ''}`,
    });
  }
  return {
    page,
    pages,
    total: count.total,
    hasMore,
    items: rows.flatMap((row) => (views.has(row.id) ? [views.get(row.id)!] : [])),
  };
}
