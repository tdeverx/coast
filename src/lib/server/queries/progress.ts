import { getFeatureConfig } from '#lib/server/features.js';
import { categoryEnabled } from '#lib/experimental.js';
import { getConfig } from '../config';
import { episodeHasAiredForProgress } from '#lib/catalogue/metadata/release-date.server.js';
import { enabledCategories, requireEnabledCategory, selectedCategory } from '../experimental';
import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch.server';
import type { MediaView } from '#lib/ui/types.js';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { progressOptionsSchema, progressSelectionTabs, type ProgressContent } from '../../progress';
import { continuationIds } from './continuations';
import { profileProgress, profileProgressPresence } from './profile';
import { listsData } from './lists';
import { AppError } from '../security/errors';
import { requireVisible } from '#lib/social/privacy.server.js';
import { workAssessments, workCards } from '#lib/collection/query.server.js';
import { applySequenceEntry, hasPermittedMediaSource, mediaViewsForIds } from './media';
import { viewingRecency } from './viewing-recency';
import { pagination, PAGE_SIZE } from './pagination';
import { heroTitleIds } from '#lib/media/hero.js';
import { readingCards } from '#lib/reading/query.server.js';
import { pausedProgressPage, pausedProgressPresent } from './paused-progress';
import { withReadCancellation } from '../db/read-cancellation';

function readingBookmarks(userId: string, workId: SQL, cycle: SQL) {
  return sql`from reading_sessions b where b.user_id=${userId} and b.work_id=${workId}
    and b.bookmark_cycle=${cycle} and b.share_id is null and b.location is not null`;
}

function hasReadingPosition(userId: string, workId: SQL, page: SQL, cycle: SQL) {
  return sql`(${page}>0 or exists(select 1 ${readingBookmarks(userId,workId,cycle)}))`;
}

function readingPositionRecency(userId: string, workId: SQL) {
  return sql`greatest(case when ${s.readingProgress.page}>0 then ${s.readingProgress.updatedAt} end,
    (select max(coalesce(b.position_updated_at,b.created_at)) ${readingBookmarks(userId,workId,sql`${s.readingProgress.bookmarkCycle}`)}))`;
}

export function readingProgressRecency(userId: string, workId: SQL, view: string) {
  const recency = view==='continue' ? readingPositionRecency(userId,workId)
    : view==='finished' ? sql`${s.readingProgress.completedAt}`
    : view==='next' ? sql`case when ${s.readingProgress.state}='planned' then ${s.readingProgress.updatedAt} end`
    : sql`${s.readingProgress.updatedAt}`;
  return sql`(select ${recency} from ${s.readingProgress} where ${s.readingProgress.userId}=${userId} and ${s.readingProgress.workId}=${workId})`;
}

type ProgressView = import('#lib/progress.js').ProgressOptions['view'];

function nativeProgressSeed(userId:string,category:'reading'|'game'|'music',view:ProgressView) {
  const next=view==='up-next'||view==='next';
  const queue=next?sql`union select media_id from up_next where user_id=${userId}`:sql``;
  const candidates=category==='reading' ? sql`select work_id as id from reading_progress where user_id=${userId}
    and state=${view==='watching'?'reading':view==='finished'?'completed':view==='dropped'?'dropped':'planned'}`
    : category==='game' ? sql`select distinct game_id as id from game_playthroughs where user_id=${userId}
      and status=${view==='watching'?'in-progress':view==='finished'?'completed':view==='dropped'?'dropped':'planned'}`
    : next ? sql`select media_id as id from up_next where user_id=${userId}`
    : sql`select track_id as id from music_progress where user_id=${userId} and position_seconds>0`;
  return sql`(${candidates} ${category==='music'?sql``:queue}) seed`;
}

function currentGamePlaythrough(userId: string, workId: SQL, projection: SQL) {
  return sql`(select ${projection} from game_playthroughs g where g.user_id=${userId} and g.game_id=${workId}
    order by g.created_at desc,g.id desc limit 1)`;
}

export function gameProgressRecency(userId: string, workId: SQL, view: string) {
  const recency = view==='finished' ? sql`g.completed_at`
    : view==='next' ? sql`case when g.status='planned' then g.updated_at end`
    : sql`g.updated_at`;
  return currentGamePlaythrough(userId,workId,recency);
}

/** Plan using lightweight IDs; hydrate only the filtered, visible page. */
export function progressData(userId:string, raw?:Partial<import('#lib/progress.js').ProgressOptions> & {category?:'screen'}, viewerId?:string):Promise<Omit<ProgressContent,'items'> & {items:MediaView[]}>;
export function progressData(userId:string, raw:unknown, viewerId?:string):Promise<ProgressContent>;
export async function progressData(userId:string, raw:unknown = {}, viewerId=userId):Promise<ProgressContent> {
  const result=await readProgressData(userId,raw,viewerId);
  // Do not probe private activity in another medium when viewing someone else's profile.
  if(userId!==viewerId||result.view==='paused')return {...result,emptyAllMedia:false};
  if(result.total)return {...result,emptyAllMedia:false};
  const config=await getFeatureConfig(viewerId);
  // An empty default medium cannot hide another medium's personal content.
  // Check lightweight relationship/activity evidence instead of hydrating extra card pages.
  const [other]=await getDb().execute<{present:boolean}>(sql`select exists(select 1 from works w where ${enabledCategories(sql`w.category`,config)} and not (${selectedCategory(sql`w.category`,result.category)}) and (
    (${result.view}='favourites' and exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and t.favourite))
    or (${result.view} in ('watchlist','next','up-next') and (exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and t.watchlist and not t.dropped)
      or exists(select 1 from up_next n where n.media_id=w.id and n.user_id=${userId}) or exists(select 1 from game_playthroughs g where g.game_id=w.id and g.user_id=${userId} and g.status='planned') or exists(select 1 from reading_progress p where p.work_id=w.id and p.user_id=${userId} and p.state='planned')))
    or (${result.view}='watching' and (exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and t.position_seconds>0 and not (t.dropped or t.paused))
      or exists(select 1 from music_progress p where p.track_id=w.id and p.user_id=${userId} and p.position_seconds>0 and (p.duration_seconds is null or p.position_seconds<p.duration_seconds))
      or ${currentGamePlaythrough(userId,sql`w.id`,sql`g.status`)}='in-progress'
      or exists(select 1 from reading_progress p where p.work_id=w.id and p.user_id=${userId} and p.state='reading'
        and ${hasReadingPosition(userId,sql`w.id`,sql`p.page`,sql`p.bookmark_cycle`)})))
    or (${result.view}='recommendations' and exists(select 1 from social_recommendations r where r.work_id=w.id and r.recipient_id=${userId} and r.state='pending'))
  )) as present`);
  return {...result,emptyAllMedia:!other.present};
}

/** Only tabbed shelves ask for availability; standalone/single-view APIs keep their existing read. */
export async function tabbedProgressData(userId:string,raw:unknown,viewerId:string,surface:'continue'|'profile',signal?:AbortSignal):Promise<ProgressContent> {
  return withReadCancellation(signal,()=>readTabbedProgress(userId,raw,viewerId,surface));
}
async function readTabbedProgress(userId:string,raw:unknown,viewerId:string,surface:'continue'|'profile'):Promise<ProgressContent> {
  const requested=v.parse(progressOptionsSchema,raw);
  if(requested.category!=='screen'||requested.kind==='book'||requested.kind==='comic')return progressData(userId,requested,viewerId);
  const planning=createScreenProgressPlanning(userId,viewerId);
  const [watching,next,paused,history]=await Promise.all([
    screenProgressPresent(userId,viewerId,'watching',planning),
    screenProgressPresent(userId,viewerId,'up-next',planning),
    pausedProgressPresent(userId,viewerId,'screen'),
    surface==='profile'?profileProgressPresence(userId,viewerId):undefined,
  ]);
  const present={watching,'up-next':next,paused,finished:history?.finished,dropped:history?.dropped};
  const availableViews:NonNullable<ProgressContent['availableViews']>=progressSelectionTabs(surface).flatMap(({value})=>value in present&&present[value as keyof typeof present]?[value]:[]);
  const options=availableViews.length&&!availableViews.includes(requested.view)
    ? {...requested,view:availableViews[0],kind:'all' as const,scope:'all' as const,page:1}
    : requested;
  if(!availableViews.length&&userId!==viewerId&&requested.view!=='paused')
    await requireVisible(userId,viewerId,'progress','screen');
  const result=availableViews.length
    ? await readProgressData(userId,options,viewerId,planning)
    : {...options,items:[],total:0,page:1,pages:1};
  return {...result,availableViews};
}

async function readProgressData(
  userId: string,
  raw: unknown = {},
  viewerId = userId,
  planning?: ReturnType<typeof createScreenProgressPlanning>,
): Promise<ProgressContent> {
  const options = v.parse(progressOptionsSchema, raw);
  if(options.view === 'recommendations') return recommendationProgress(userId,viewerId,options);
  if(options.view === 'paused') return {...options,...await pausedProgressPage(userId,viewerId,options)};
  if(options.category==='reading')return readingProgress(userId,viewerId,options);
  if(options.kind==='book'||options.kind==='comic')throw new AppError(400,'Choose a reading type only for Reading.');
  if(userId!==viewerId) {
    await requireVisible(userId,viewerId,options.view==='favourites'?'favourites':['next','watchlist'].includes(options.view)?'collection':'progress',options.category);
    if(options.view==='next')await requireVisible(userId,viewerId,'progress',options.category);
  }
  if (options.category !== 'screen') return mediumProgress(userId, viewerId, options);
  if (options.view === 'watchlist' || options.view === 'favourites') {
    const list = await listsData(userId, { ...options, filter: 'to-watch',category:'screen' }, viewerId, 'saved');
    return { ...options, page: list.page, pages: list.pages, total: list.total, items: list.items.filter((item):item is MediaView=>!('href' in item)) };
  }
  if (options.view === 'finished' || options.view === 'dropped') {
    const result = await profileProgress(
      userId,
      options.view === 'finished' ? 'watched' : 'dropped',
      options.page,
      {kind:options.kind,scope:options.scope},
      viewerId
    );
    return {
      ...options,
      items: result.items,
      total: result.total,
      page: result.page,
      pages: result.pages,
    };
  }
  const { ids: visibleIds, page, pages, total, sequenceById } = await screenProgressPlan(userId, options, viewerId,{planning});
  const presentation = options.view === 'watching' ? 'continue' : 'next';
  const views = new Map(
    (await mediaViewsForIds(userId, visibleIds, viewerId, true, presentation)).map((item) => [item.id, item])
  );
  const items = visibleIds.flatMap((id) => (views.has(id) ? [views.get(id)!] : []));
  decorateProgressCards(items, sequenceById, options.view);
  return { ...options, page, pages, total, items };
}

export function decorateProgressCards(items:MediaView[], sequenceById:Awaited<ReturnType<typeof screenProgressPlan>>['sequenceById'], view:string) {
  for (let index = 0; index < items.length; index++) {
    let item = items[index];
    const context = sequenceById.get(item.id);
    if (context && (view !== 'watching' || context.entry.progress > 0)) {
      item = items[index] = applySequenceEntry(item, context.entry, context.source);
      if (!item.captionSubtitle) {
        item.captionSubtitleHref = context.source.kind==='collection'?`/media/${context.source.id}`:`/lists/${context.source.id}`;
        item.captionSubtitle = context.title + (item.rewatchStartedAt ? ' · Rewatching' : '');
      }
      continue;
    }
    if (view === 'watching' || view === 'next' || view === 'up-next' || view === 'finished') continue;
    const title = item.showTitle;
    if (!title) {
      if (item.rewatchStartedAt) item.captionSubtitle = 'Rewatching';
      continue;
    }
    item.captionTitle = title;
    item.captionTitleHref = item.showId?`/media/${item.showId}`:undefined;
    item.captionSubtitleHref = `/media/${item.id}`;
    item.captionSubtitle =
      item.kind === 'episode'
        ? `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(item.episodeNumber ?? 0).padStart(2, '0')} ${item.title}`
        : item.title?.trim() || `Season ${item.seasonNumber ?? 0}`;
    if (item.rewatchStartedAt) item.captionSubtitle += ' · Rewatching';
  }
}

/** A single local page shares Continue/Next/saved rows without treating pages as playback. */
async function readingProgress(userId:string, viewerId:string, options:import('#lib/progress.js').ProgressOptions):Promise<ProgressContent> {
  const {where,progressVisible}=readingProgressSelection(userId,viewerId,options,await getFeatureConfig(viewerId));
  const db=getDb();
  const base=()=>db.select().from(s.readingWorks)
    .leftJoin(s.readingProgress,and(eq(s.readingProgress.workId,s.readingWorks.id),eq(s.readingProgress.userId,userId)))
    .leftJoin(s.trackingState,and(eq(s.trackingState.mediaId,s.readingWorks.id),eq(s.trackingState.userId,userId)));
  const [count]=await db.select({total:sql<number>`count(*)::int`}).from(s.readingWorks)
    .leftJoin(s.readingProgress,and(eq(s.readingProgress.workId,s.readingWorks.id),eq(s.readingProgress.userId,userId)))
    .leftJoin(s.trackingState,and(eq(s.trackingState.mediaId,s.readingWorks.id),eq(s.trackingState.userId,userId))).where(where);
  const {page,pages}=pagination(count.total,options.page);
  const order=options.view==='watching' ? readingPositionRecency(userId,sql`${s.readingWorks.id}`)
    : options.view==='finished' ? sql`${s.readingProgress.completedAt}`
    : options.view==='dropped' ? sql`${s.readingProgress.updatedAt}`
    : options.view==='watchlist'||options.view==='favourites' ? sql`${s.trackingState.updatedAt}`
    : sql`greatest(case when ${progressVisible} and ${s.readingProgress.state}='planned' then ${s.readingProgress.updatedAt} end,
        (select n.created_at from up_next n where n.user_id=${userId} and n.media_id=${s.readingWorks.id}))`;
  const rows=await base().where(where).orderBy(sql`${order} desc nulls last`,s.readingWorks.id).limit(PAGE_SIZE).offset((page-1)*PAGE_SIZE);
  return {...options,page,pages,total:count.total,items:await readingCards(userId,viewerId,rows.map(row=>row.reading_works))};
}

function readingProgressSelection(userId:string,viewerId:string,options:import('#lib/progress.js').ProgressOptions, config:Awaited<ReturnType<typeof getFeatureConfig>>) {
  requireEnabledCategory(config,'reading');
  if(options.kind!=='all'&&!['book','comic'].includes(options.kind))throw new AppError(400,'Choose Books or Comics.');
  if(options.kind!=='all')requireEnabledCategory(config,options.kind);
  const progressVisible=sql`social_visible(${userId}::uuid,${viewerId}::uuid,'progress',${s.readingWorks.kind})`;
  const saved=sql`social_visible(${userId}::uuid,${viewerId}::uuid,'collection',${s.readingWorks.kind}) and coalesce(${s.trackingState.watchlist},false)`;
  const state=sql`case when ${progressVisible} then ${s.readingProgress.state} else null end`;
  const selection=options.view==='favourites'
    ? sql`social_visible(${userId}::uuid,${viewerId}::uuid,'favourites',${s.readingWorks.kind}) and ${s.trackingState.favourite}`
    : options.view==='watching' ? sql`${state}='reading' and ${hasReadingPosition(userId,sql`${s.readingWorks.id}`,sql`${s.readingProgress.page}`,sql`${s.readingProgress.bookmarkCycle}`)}`
    : options.view==='finished' ? sql`${state}='completed'`
    : options.view==='dropped' ? sql`${state}='dropped'`
    : options.view==='watchlist' ? saved
    : sql`${progressVisible} and social_visible(${userId}::uuid,${viewerId}::uuid,'collection',${s.readingWorks.kind})
      and (${state}='planned' or exists(select 1 from up_next n where n.user_id=${userId} and n.media_id=${s.readingWorks.id}))
      and coalesce(${state} not in ('reading','paused','completed','dropped'),true)`;
  const available=sql`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.media_id=${s.readingWorks.id} and a.user_id=${viewerId} and c.user_id=${viewerId} and a.state='available' and c.status='connected' and i.enabled)`;
  const seed=options.view==='watchlist'||options.view==='favourites'?undefined:sql`${s.readingWorks.id} in (select seed.id from ${nativeProgressSeed(userId,'reading',options.view)})`;
  const where=and(seed,enabledCategories(sql`${s.readingWorks.kind}`,config),options.kind==='all'?undefined:eq(s.readingWorks.kind,options.kind as 'book'|'comic'),selection,options.scope==='available'?available:undefined);
  return {where,progressVisible};
}
export async function readingProgressIds(userId:string,options:import('#lib/progress.js').ProgressOptions,viewerId=userId,features?:Awaited<ReturnType<typeof getFeatureConfig>>) {
  const {where}=readingProgressSelection(userId,viewerId,options,features??await getFeatureConfig(viewerId));
  const rows=await getDb().select({id:s.readingWorks.id}).from(s.readingWorks)
    .leftJoin(s.readingProgress,and(eq(s.readingProgress.workId,s.readingWorks.id),eq(s.readingProgress.userId,userId)))
    .leftJoin(s.trackingState,and(eq(s.trackingState.mediaId,s.readingWorks.id),eq(s.trackingState.userId,userId))).where(where);
  return rows.map(row=>row.id);
}

/** The hero shares Continue's selection/order without hydrating a hidden card page. */
export async function continueHeroId(userId: string) {
  const { ids } = await screenProgressPlan(userId, v.parse(progressOptionsSchema, {}), userId);
  if (!ids.length) return undefined;
  const rows = await getDb().select({
    id: s.media.id, kind: s.media.kind,
    showId: sql<string | null>`coalesce(${s.episodes.showId}, ${s.seasons.showId})`,
  }).from(s.media)
    .leftJoin(s.episodes, eq(s.episodes.mediaId, s.media.id))
    .leftJoin(s.seasons, eq(s.seasons.mediaId, s.media.id))
    .where(inArray(s.media.id, ids));
  const byId = new Map(rows.map(row => [row.id, { ...row, showId: row.showId ?? undefined }]));
  return heroTitleIds(ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []))[0];
}

async function screenProgressInputs(userId: string, viewerId: string, firstEpisode: boolean) {
  const db = getDb();
  const {metadataSource} = await getConfig();
  const states = await db
    .select({
      id: s.trackingState.mediaId,
      ownRewatch: sql<boolean>`exists(select 1 from rewatches r where r.user_id=${userId} and r.media_id=${s.media.id})`,
      ...rewatchFields(userId, sql`${s.media.id}`),
      duration: s.trackingState.durationSeconds,
      dropped: s.trackingState.dropped,
      kind: s.media.kind,
    })
    .from(s.trackingState)
    .innerJoin(s.media, eq(s.media.id, s.trackingState.mediaId))
    .where(and(eq(s.trackingState.userId, userId), eq(s.trackingState.dropped, false), eq(s.trackingState.paused, false), sql`(${s.trackingState.watched} or ${s.trackingState.positionSeconds}>0 or ${rewatchBoundary(userId, sql`${s.media.id}`)} is not null)`))
    .orderBy(desc(s.trackingState.updatedAt), s.media.id);
  const planned = await continuationIds(
    userId,
    states.filter((row) => !row.dropped && (row.watched || row.progress > 0)).map((row) => row.id),
    false,
    viewerId === userId,
    firstEpisode,
    metadataSource
  );
  const sequenceById = new Map(planned.sequenceNext.map((next) => [next.entry.mediaId, next]));
  const activeIds = states
    .filter(
      (row) =>
        !row.dropped &&
        ((row.progress > 0 && (!row.duration || row.progress < row.duration * 0.9)) ||
          (row.ownRewatch && !row.watched)) &&
        ['movie', 'episode'].includes(row.kind)
    )
    .map((row) => row.id);
  for (const next of planned.sequenceNext) {
    if (next.entry.progress > 0 && !next.entry.watched && !activeIds.includes(next.entry.mediaId))
      activeIds.push(next.entry.mediaId);
  }
  return { metadataSource, planned, activeIds, sequenceById };
}

/** A tab summary and the retained page share the episode and sequence read. */
export function createScreenProgressPlanning(userId: string, viewerId: string, firstEpisode = false) {
  let input: ReturnType<typeof screenProgressInputs> | undefined;
  return () => input ??= screenProgressInputs(userId, viewerId, firstEpisode);
}

async function screenProgressMembership(
  userId: string,
  options: import('#lib/progress.js').ProgressOptions,
  viewerId: string,
  planning: ReturnType<typeof createScreenProgressPlanning>
) {
  const db = getDb();
  const { metadataSource, planned, activeIds, sequenceById } = await planning();
  const queued =
    (options.view === 'up-next' || options.view === 'next')
      ? await db
          .select({ id: s.upNext.mediaId })
          .from(s.upNext)
          .where(eq(s.upNext.userId, userId))
          .orderBy(desc(s.upNext.addedAt), s.upNext.mediaId)
      : [];
  const saved = options.view === 'next' ? await db.select({ id:s.media.id }).from(s.trackingState)
    .innerJoin(s.media,eq(s.media.id,s.trackingState.mediaId))
    .where(and(eq(s.trackingState.userId,userId),eq(s.trackingState.watchlist,true),eq(s.trackingState.watched,false),eq(s.trackingState.dropped,false),inArray(s.media.kind,['movie','show','collection']),
      sql`(${s.media.kind}<>'show' or (${s.trackingState.positionSeconds}=0 and ${s.trackingState.completedEpisodes}=0 and not exists(
        select 1 from episodes e join tracking_state child on child.media_id=e.media_id and child.user_id=${userId}
        where e.show_id=${s.media.id} and not e.is_special and (child.watched or child.position_seconds>0))))`)) : [];
  const candidateIds = [
    ...new Set(
      options.view === 'watching'
        ? [...activeIds, ...planned.nextIds]
        : [
            ...saved.map(row=>row.id),
            ...queued.map((row) => row.id),
            ...planned.newSeasonIds,
            ...planned.nextIds,
            ...sequenceById.keys(),
          ]
    ),
  ];
  const member = (ids: string[]) => sql`${s.media.id} = any(${`{${ids.join(',')}}`}::uuid[])`;
  const aired = (id: SQL) => episodeHasAiredForProgress(id, metadataSource);
  const sequenceIds = [...sequenceById.keys()];
  const nextIds = [...queued.map(row => row.id), ...saved.map(row => row.id), ...sequenceIds, ...planned.newSeasonIds];
  const where = and(
        member(candidateIds),
        options.view === 'watching'
          ? sql`(${member(activeIds)} or ${s.media.kind} = 'episode')`
          : sql`not (${member(activeIds)}) and (${member(nextIds)} or ${s.media.kind} in ('season','movie') or
              (${options.view === 'next'} and ${s.media.kind} = 'episode'))`,
        sql`case ${s.media.kind}
          when 'episode' then ${aired(sql`${s.media.id}`)}
          when 'show' then exists(select 1 from episodes e where e.show_id=${s.media.id} and not e.is_special and ${aired(sql`e.media_id`)})
          when 'season' then exists(select 1 from episodes e where e.season_id=${s.media.id} and not e.is_special and ${aired(sql`e.media_id`)})
          else true end`,
        options.kind === 'movie'
          ? eq(s.media.kind, 'movie')
          : options.kind === 'show'
            ? inArray(s.media.kind, ['show', 'season', 'episode'])
            : undefined,
        options.scope === 'available' ? hasPermittedMediaSource(viewerId) : undefined,
        sql`not exists (select 1 from episodes e join tracking_state parent on parent.media_id in (e.show_id,e.season_id)
          where e.media_id = ${s.media.id} and parent.user_id = ${userId} and (parent.dropped or parent.paused))`,
        sql`not exists (select 1 from tracking_state paused where paused.user_id = ${userId} and (paused.paused or paused.dropped)
          and paused.media_id in (${s.media.id}, (select season.show_id from seasons season where season.media_id = ${s.media.id})))`,
        // Occurrence-aware sequence planning has already evaluated completion for its own run.
        options.view === 'watching' ? undefined : sql`(${member(sequenceIds)} or not exists (
          select 1 from tracking_state t where t.user_id=${userId} and t.media_id=${s.media.id}
          and t.watched and ${rewatchBoundary(userId,sql`${s.media.id}`)} is null))`
  );
  return { candidateIds, sequenceById, where };
}

export async function screenProgressPlan(userId: string, options: import('#lib/progress.js').ProgressOptions, viewerId: string, {
  firstEpisode = false, sortByActivity = true, planning = createScreenProgressPlanning(userId, viewerId, firstEpisode),
}: { firstEpisode?: boolean; sortByActivity?: boolean; planning?: ReturnType<typeof createScreenProgressPlanning> } = {}) {
  const db = getDb();
  const { candidateIds, sequenceById, where } = await screenProgressMembership(userId, options, viewerId, planning);
  if (!candidateIds.length) return { ids: [], allIds: [], total: 0, page: 1, pages: 1, sequenceById };
  const candidates = await db
    .select({ id: s.media.id })
    .from(s.media)
    .where(where)
    .orderBy(
      ...(options.view === 'watching' && sortByActivity
        ? [
            sql`greatest(${rewatchBoundary(userId, sql`${s.media.id}`)}, ${viewingRecency(userId, sql`coalesce((select e.show_id from episodes e where e.media_id = ${s.media.id}), ${s.media.id})`)}) desc nulls last`,
          ]
        : []),
      s.media.id
    );
  const matched = candidates.map(row => row.id);
  const eligible = new Set(matched);
  let ids = options.view === 'watching' ? matched : candidateIds.filter(id => eligible.has(id));
  if(options.view==='next' && ids.length) {
    // An exact next episode represents its saved parent without a duplicate show card.
    const represented=await db.select({id:s.episodes.showId}).from(s.episodes).where(inArray(s.episodes.mediaId,ids));
    const parents=new Set(represented.map(row=>row.id));
    ids=ids.filter(id=>!parents.has(id));
  }
  const { page, pages } = pagination(ids.length, options.page);
  const visibleIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { ids: visibleIds, allIds: ids, page, pages, total: ids.length, sequenceById };
}

export async function screenProgressPresent(
  userId: string, viewerId: string, view: 'watching'|'up-next',
  planning: ReturnType<typeof createScreenProgressPlanning>,
  includeCollectionCheck = false,
) {
  const options = v.parse(progressOptionsSchema, {view});
  const {candidateIds,where} = await screenProgressMembership(userId,options,viewerId,planning);
  if (!candidateIds.length) return false;
  const [result] = await getDb().execute<{present:boolean}>(sql`select exists(
    select 1 from ${s.media} where ${where}
      and social_visible(${userId}::uuid,${viewerId}::uuid,'progress','screen')
      ${includeCollectionCheck ? sql`and social_visible(${userId}::uuid,${viewerId}::uuid,'collection','screen')` : sql``}
  ) as present`);
  return result.present;
}

/** Concrete game/music activity stays in its own tables; only presentation is shared. */
async function mediumProgress(userId:string, viewerId:string, options:import('#lib/progress.js').ProgressOptions):Promise<ProgressContent> {
  requireEnabledCategory(await getFeatureConfig(viewerId),options.category);
  if(options.category==='music'&&['finished','dropped'].includes(options.view))throw new AppError(400,'Choose Continue, Next or a saved view for Music.');
  const saved=options.view==='watchlist'||options.view==='favourites';
  if(saved) {
    const list=await listsData(userId,{...options,filter:'to-watch'},viewerId);
    return {...options,page:list.page,pages:list.pages,total:list.total,items:list.items};
  }
  const {where,available}=mediumProgressSelection(userId,viewerId,options);
  const db=getDb();
  const [count]=await db.execute<{total:number}>(sql`select count(*)::int as total from works w where ${where}`);
  const {page,pages}=pagination(count.total,options.page);
  const continuing=options.view==='watching';
  const activity=options.category==='game' ? gameProgressRecency(userId,sql`w.id`,continuing?'continue':options.view==='finished'||options.view==='dropped'?options.view:'next')
    : continuing ? sql`(select p.updated_at from music_progress p where p.user_id=${userId} and p.track_id=w.id)` : sql`null`;
  const order=continuing||options.view==='finished'||options.view==='dropped' ? activity : sql`greatest(${activity},
    (select n.created_at from up_next n where n.user_id=${userId} and n.media_id=w.id))`;
  const rows=await db.execute<{id:string;available:boolean}>(sql`select w.id,${available} as available from works w where ${where} order by ${order} desc nulls last,w.id
    limit ${PAGE_SIZE} offset ${(page-1)*PAGE_SIZE}`);
  const availability=new Map(Array.from(rows).map(row=>[row.id,row.available]));
  const cards=await workCards(userId,viewerId,Array.from(rows).map(row=>row.id));
  return {...options,page,pages,total:count.total,items:cards.map(card=>({...card,available:availability.get(('workId' in card ? card.workId : undefined)??card.id)??false}))};
}

function mediumProgressSelection(userId:string,viewerId:string,options:import('#lib/progress.js').ProgressOptions) {
  const game=options.category==='game';
  const gameStatus=currentGamePlaythrough(userId,sql`w.id`,sql`g.status`);
  const active=sql`exists(select 1 from music_progress p where p.user_id=${userId} and p.track_id=w.id and p.position_seconds>0 and (p.duration_seconds is null or p.position_seconds<p.duration_seconds))`;
  const queued=sql`exists(select 1 from up_next n where n.user_id=${userId} and n.media_id=w.id)`;
  const next=options.view==='next'||options.view==='up-next';
  const selection=options.view==='watching' ? game?sql`${gameStatus}='in-progress'`:active
    : options.view==='finished' ? sql`${gameStatus}='completed'`
    : options.view==='dropped' ? sql`${gameStatus}='dropped'`
    : game ? sql`(${queued} or ${gameStatus}='planned') and coalesce(${gameStatus}='planned',true)`
    : sql`${queued} and not ${active}`;
  const available=sql`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id
    where a.user_id=${viewerId} and c.user_id=${viewerId} and c.status='connected' and i.enabled and a.state='available' and
    (a.media_id=w.id or exists(select 1 from media_relationships r where r.parent_id=w.id and r.child_id=a.media_id and r.kind='contains')))`;
  const seed=nativeProgressSeed(userId,game?'game':'music',options.view);
  const where=sql`w.id in (select seed.id from ${seed}) and w.category=${options.category} and social_visible(${userId}::uuid,${viewerId}::uuid,'progress',${options.category})
    ${next?sql`and social_visible(${userId}::uuid,${viewerId}::uuid,'collection',${options.category})`:sql``}
    and (${options.scope}='all' or ${available}) and (${selection})`;
  return {where,available};
}

/** Lightweight candidates only; card hydration remains after mixed pagination. */
export async function mediumProgressIds(userId:string,options:import('#lib/progress.js').ProgressOptions,viewerId=userId,features?:Awaited<ReturnType<typeof getFeatureConfig>>) {
  requireEnabledCategory(features??await getFeatureConfig(viewerId),options.category);
  const {where}=mediumProgressSelection(userId,viewerId,options);
  const rows=await getDb().execute<{id:string}>(sql`select w.id from works w where ${where}`);
  return Array.from(rows,row=>row.id);
}

/** Keep alternate tab reads in the native game/reading membership owners. */
export async function nonScreenProgressPresence(userId:string,viewerId:string,category:string|undefined,features:Awaited<ReturnType<typeof getFeatureConfig>>,includeHistory=false) {
  const games=(!category||category==='game')&&categoryEnabled(features,'game');
  const reading=(!category||category==='reading')&&categoryEnabled(features,'reading');
  if(!games&&!reading)return {continue:false,next:false,finished:false,dropped:false};
  const views = includeHistory ? ['watching','up-next','finished','dropped'] as const : ['watching','up-next'] as const;
  const checks=views.map(view=>{
    const options=v.parse(progressOptionsSchema,{view});
    const parts=[];
    if(games) {
      const {where}=mediumProgressSelection(userId,viewerId,{...options,category:'game'});
      parts.push(sql`exists(select 1 from works w where ${where})`);
    }
    if(reading) {
      const {where}=readingProgressSelection(userId,viewerId,{...options,category:'reading'},features);
      parts.push(sql`exists(select 1 from ${s.readingWorks}
        left join ${s.readingProgress} on ${s.readingProgress.workId}=${s.readingWorks.id} and ${s.readingProgress.userId}=${userId}
        where ${where})`);
    }
    return sql`(${sql.join(parts,sql` or `)})`;
  });
  const [result]=await getDb().execute<{continue:boolean;next:boolean;finished:boolean;dropped:boolean}>(sql`select ${checks[0]} as "continue",${checks[1]} as next, ${checks[2]??sql`false`} as finished, ${checks[3]??sql`false`} as dropped`);
  return result;
}

/** Received recommendations outlive notification delivery; filter IDs before hydrating a page. */
async function recommendationProgress(userId:string,viewerId:string,options:import('#lib/progress.js').ProgressOptions):Promise<ProgressContent> {
  if(userId!==viewerId)throw new AppError(403,'Recommendations are private to their recipient.');
  const config=await getFeatureConfig(viewerId);requireEnabledCategory(config,options.category);
  if(options.category==='reading'&&options.kind!=='all'&&!['book','comic'].includes(options.kind)||options.category!=='reading'&&['book','comic'].includes(options.kind))throw new AppError(400,'Choose a type for the selected medium.');
  if(['book','comic'].includes(options.kind))requireEnabledCategory(config,options.kind);
  const rows=await getDb().execute<{workId:string;ids:string[];names:string[]}>(sql`
    select r.work_id as "workId",array_agg(r.id::text order by r.created_at desc,r.id desc) as ids,
      array_agg(u.username order by r.created_at desc,r.id desc) as names
    from social_recommendations r join users u on u.id=r.sender_id join works w on w.id=r.work_id
    where r.recipient_id=${userId} and r.state='pending' and not u.disabled and ${selectedCategory(sql`w.category`,options.category)} and ${enabledCategories(sql`w.category`,config)}
      and (${options.kind}='all' or w.kind=${options.kind})
      and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(r.sender_id,r.recipient_id) and f.user_b=greatest(r.sender_id,r.recipient_id))
    group by r.work_id order by max(r.created_at) desc,r.work_id`);
  let candidates=Array.from(rows);
  if(options.scope==='available'&&candidates.length){
    const available=new Set((await workAssessments(userId,viewerId,candidates.map(r=>r.workId))).filter(a=>['available','partial'].includes(a.availability)).map(a=>a.id));
    candidates=candidates.filter(r=>available.has(r.workId));
  }
  const {page,pages}=pagination(candidates.length,options.page),visible=candidates.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const cards=new Map((await workCards(userId,viewerId,visible.map(r=>r.workId))).map(card=>['workId' in card?card.workId??card.id:card.id,card]));
  const items=visible.flatMap(row=>{const card=cards.get(row.workId);return card?[{...card,recommendationIds:row.ids,captionSubtitle:`Recommended by ${[...new Set(row.names)].join(', ')}`}]:[];});
  return {...options,page,pages,total:candidates.length,items};
}
