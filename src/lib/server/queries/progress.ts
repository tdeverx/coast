import { enabledCategories, requireEnabledCategory, selectedCategory } from '../experimental';
import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch.server';
import type { MediaView } from '$lib/ui/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { progressOptionsSchema, type ProgressContent } from '../../progress';
import { continuationIds } from './continuations';
import { profileProgress } from './profile';
import { listsData } from './lists';
import { getConfig } from '../config';
import { AppError } from '../security/errors';
import { requireVisible } from '$lib/social/privacy.server';
import { workAssessments, workCards } from '$lib/collection/query.server';
import { applySequenceEntry, hasPermittedMediaSource, mediaViewsForIds } from './media';
import { viewingRecency } from './viewing-recency';
import { pagination, PAGE_SIZE } from './pagination';
import { heroTitleIds } from '$lib/media/hero';
import { readingCards } from '$lib/reading/query.server';

/** Plan using lightweight IDs; hydrate only the filtered, visible page. */
export function progressData(userId:string, raw?:Partial<import('$lib/progress').ProgressOptions> & {category?:'screen'}, viewerId?:string):Promise<Omit<ProgressContent,'items'> & {items:MediaView[]}>;
export function progressData(userId:string, raw:unknown, viewerId?:string):Promise<ProgressContent>;
export async function progressData(userId:string, raw:unknown = {}, viewerId=userId):Promise<ProgressContent> {
  const result=await readProgressData(userId,raw,viewerId);
  // Do not probe private activity in another medium when viewing someone else's profile.
  if(userId!==viewerId)return {...result,emptyAllMedia:false};
  if(result.total)return {...result,emptyAllMedia:false};
  const config=await getConfig();
  // An empty default medium cannot hide another medium's personal content.
  // Check lightweight relationship/activity evidence instead of hydrating extra card pages.
  const [other]=await getDb().execute<{present:boolean}>(sql`select exists(select 1 from works w where ${enabledCategories(sql`w.category`,config)} and not (${selectedCategory(sql`w.category`,result.category)}) and (
    (${result.view}='favourites' and exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and t.favourite))
    or (${result.view} in ('watchlist','next','up-next') and (exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and t.watchlist and not t.dropped)
      or exists(select 1 from up_next n where n.media_id=w.id and n.user_id=${userId}) or exists(select 1 from game_playthroughs g where g.game_id=w.id and g.user_id=${userId} and g.status='planned') or exists(select 1 from reading_progress p where p.work_id=w.id and p.user_id=${userId} and p.state='planned')))
    or (${result.view}='watching' and (exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and t.position_seconds>0 and not t.dropped)
      or exists(select 1 from music_progress p where p.track_id=w.id and p.user_id=${userId} and p.position_seconds>0)
      or exists(select 1 from game_playthroughs g where g.game_id=w.id and g.user_id=${userId} and g.status in ('in-progress','paused'))
      or exists(select 1 from reading_progress p where p.work_id=w.id and p.user_id=${userId} and p.state in ('reading','paused'))))
    or (${result.view}='recommendations' and exists(select 1 from social_recommendations r where r.work_id=w.id and r.recipient_id=${userId} and r.state='pending'))
  )) as present`);
  return {...result,emptyAllMedia:!other.present};
}
async function readProgressData(
  userId: string,
  raw: unknown = {},
  viewerId = userId
): Promise<ProgressContent> {
  const options = v.parse(progressOptionsSchema, raw);
  if(options.view === 'recommendations') return recommendationProgress(userId,viewerId,options);
  if(options.category==='reading')return readingProgress(userId,viewerId,options);
  if(options.kind==='book'||options.kind==='comic')throw new AppError(400,'Choose a reading type only for Reading.');
  if(userId!==viewerId) {
    await requireVisible(userId,viewerId,options.view==='favourites'?'favourites':['next','watchlist'].includes(options.view)?'collection':'progress',options.category);
    if(options.view==='next')await requireVisible(userId,viewerId,'progress',options.category);
  }
  if (options.category !== 'screen') return mediumProgress(userId, viewerId, options);
  if (options.view === 'watchlist' || options.view === 'favourites') {
    const list = await listsData(userId, { ...options, filter: 'to-watch',category:'screen' }, viewerId);
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
  const { ids: visibleIds, page, pages, total, sequenceById } = await screenProgressPlan(userId, options, viewerId);
  const views = new Map(
    (await mediaViewsForIds(userId, visibleIds, viewerId)).map((item) => [item.id, item])
  );
  const items = visibleIds.flatMap((id) => (views.has(id) ? [views.get(id)!] : []));
  const showIds = [...new Set(items.flatMap((item) => (item.showId ? [item.showId] : [])))];
  const titles = new Map(
    (await mediaViewsForIds(userId, showIds, viewerId)).map((item) => [item.id, item.title])
  );
  for (let index = 0; index < items.length; index++) {
    let item = items[index];
    const context = sequenceById.get(item.id);
    if (context && (options.view !== 'watching' || context.entry.progress > 0)) {
      item = items[index] = applySequenceEntry(item, context.entry, context.source);
      item.captionSubtitle = context.title + (item.rewatchStartedAt ? ' · Rewatching' : '');
      continue;
    }
    const title = item.showId ? titles.get(item.showId) : undefined;
    if (!title) {
      if (item.rewatchStartedAt) item.captionSubtitle = 'Rewatching';
      continue;
    }
    item.captionTitle = title;
    item.captionSubtitle =
      item.kind === 'episode'
        ? `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(item.episodeNumber ?? 0).padStart(2, '0')} ${item.title}`
        : item.title?.trim() || `Season ${item.seasonNumber ?? 0}`;
    if (item.rewatchStartedAt) item.captionSubtitle += ' · Rewatching';
  }
  return { ...options, page, pages, total, items };
}

/** A single local page shares Continue/Next/saved rows without treating pages as playback. */
async function readingProgress(userId:string, viewerId:string, options:import('$lib/progress').ProgressOptions):Promise<ProgressContent> {
  const config=await getConfig();
  requireEnabledCategory(config,'reading');
  if(options.kind!=='all'&&!['book','comic'].includes(options.kind))throw new AppError(400,'Choose Books or Comics.');
  if(options.kind!=='all')requireEnabledCategory(config,options.kind);
  const progressVisible=sql`social_visible(${userId}::uuid,${viewerId}::uuid,'progress',${s.readingWorks.kind})`;
  const saved=sql`social_visible(${userId}::uuid,${viewerId}::uuid,'collection',${s.readingWorks.kind}) and coalesce(${s.trackingState.watchlist},false)`;
  const state=sql`case when ${progressVisible} then ${s.readingProgress.state} else null end`;
  const selection=options.view==='favourites'
    ? sql`social_visible(${userId}::uuid,${viewerId}::uuid,'favourites',${s.readingWorks.kind}) and ${s.trackingState.favourite}`
    : options.view==='watching' ? sql`${state} in ('reading','paused')`
    : options.view==='finished' ? sql`${state}='completed'`
    : options.view==='dropped' ? sql`${state}='dropped'`
    : sql`((${saved}) or (${options.view}<>'watchlist' and ${state}='planned')) and coalesce(${state} not in ('reading','paused','completed','dropped'),true)`;
  const available=sql`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.media_id=${s.readingWorks.id} and a.user_id=${viewerId} and c.user_id=${viewerId} and a.state='available' and c.status='connected' and i.enabled)`;
  const where=and(enabledCategories(sql`${s.readingWorks.kind}`,config),options.kind==='all'?undefined:eq(s.readingWorks.kind,options.kind as 'book'|'comic'),selection,options.scope==='available'?available:undefined);
  const db=getDb();
  const base=()=>db.select().from(s.readingWorks)
    .leftJoin(s.readingProgress,and(eq(s.readingProgress.workId,s.readingWorks.id),eq(s.readingProgress.userId,userId)))
    .leftJoin(s.trackingState,and(eq(s.trackingState.mediaId,s.readingWorks.id),eq(s.trackingState.userId,userId)));
  const [count]=await db.select({total:sql<number>`count(*)::int`}).from(s.readingWorks)
    .leftJoin(s.readingProgress,and(eq(s.readingProgress.workId,s.readingWorks.id),eq(s.readingProgress.userId,userId)))
    .leftJoin(s.trackingState,and(eq(s.trackingState.mediaId,s.readingWorks.id),eq(s.trackingState.userId,userId))).where(where);
  const {page,pages}=pagination(count.total,options.page);
  const rows=await base().where(where).orderBy(sql`greatest(case when ${progressVisible} then ${s.readingProgress.updatedAt} end,${s.trackingState.updatedAt}) desc nulls last`,s.readingWorks.id).limit(PAGE_SIZE).offset((page-1)*PAGE_SIZE);
  return {...options,page,pages,total:count.total,items:await readingCards(userId,viewerId,rows.map(row=>row.reading_works))};
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

async function screenProgressPlan(userId: string, options: import('$lib/progress').ProgressOptions, viewerId: string) {
  const db = getDb();
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
    .where(eq(s.trackingState.userId, userId))
    .orderBy(desc(s.trackingState.updatedAt), s.media.id);
  const planned = await continuationIds(
    userId,
    states.filter((row) => !row.dropped && (row.watched || row.progress > 0)).map((row) => row.id),
    false
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
  if (!candidateIds.length) return { ids: [], total: 0, page: 1, pages: 1, sequenceById };
  const active = new Set(activeIds),
    manual = new Set([...queued,...saved].map((row) => row.id));
  const candidates = await db
    .select({ id: s.media.id, kind: s.media.kind })
    .from(s.media)
    .where(
      and(
        inArray(s.media.id, candidateIds),
        options.kind === 'movie'
          ? eq(s.media.kind, 'movie')
          : options.kind === 'show'
            ? inArray(s.media.kind, ['show', 'season', 'episode'])
            : undefined,
        options.scope === 'available' ? hasPermittedMediaSource(viewerId) : undefined,
        sql`not exists (select 1 from episodes e join tracking_state parent on parent.media_id in (e.show_id,e.season_id)
      where e.media_id = ${s.media.id} and parent.user_id = ${userId} and parent.dropped)`
      )
    )
    .orderBy(
      ...(options.view === 'watching'
        ? [
            sql`greatest(${rewatchBoundary(userId, sql`${s.media.id}`)}, ${viewingRecency(userId, sql`coalesce((select e.show_id from episodes e where e.media_id = ${s.media.id}), ${s.media.id})`)}) desc nulls last`,
          ]
        : []),
      s.media.id
    );
  const eligible = new Set(
    candidates
      .filter((row) =>
        options.view === 'watching'
          ? active.has(row.id) || row.kind === 'episode'
          : !active.has(row.id) &&
            (manual.has(row.id) ||
              sequenceById.has(row.id) ||
              (options.view === 'next' && row.kind === 'episode') ||
              row.kind === 'season' ||
              row.kind === 'movie')
      )
      .map((row) => row.id)
  );
  let ids = (options.view === 'watching' ? candidates.map((row) => row.id) : candidateIds).filter(id => eligible.has(id));
  if(options.view==='next' && ids.length) {
    // An exact next episode represents its saved parent without a duplicate show card.
    const represented=await db.select({id:s.episodes.showId}).from(s.episodes).where(inArray(s.episodes.mediaId,ids));
    const parents=new Set(represented.map(row=>row.id));
    ids=ids.filter(id=>!parents.has(id));
  }
  const { page, pages } = pagination(ids.length, options.page);
  const visibleIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { ids: visibleIds, page, pages, total: ids.length, sequenceById };
}

/** Concrete game/music activity stays in its own tables; only presentation is shared. */
async function mediumProgress(userId:string, viewerId:string, options:import('$lib/progress').ProgressOptions):Promise<ProgressContent> {
  requireEnabledCategory(await getConfig(),options.category);
  if(['finished','dropped'].includes(options.view))throw new AppError(400,'Choose Continue, Next or a saved view for this medium.');
  const saved=options.view==='watchlist'||options.view==='favourites';
  if(saved) {
    const list=await listsData(userId,{...options,filter:'to-watch'},viewerId);
    return {...options,page:list.page,pages:list.pages,total:list.total,items:list.items};
  }
  const active=options.category==='game'
    ? sql`(select g.status from game_playthroughs g where g.user_id=${userId} and g.game_id=w.id order by g.created_at desc,g.id desc limit 1) in ('in-progress','paused')`
    : sql`exists(select 1 from music_progress p where p.user_id=${userId} and p.track_id=w.id and p.position_seconds>0 and (p.duration_seconds is null or p.position_seconds<p.duration_seconds))`;
  const planned=sql`exists(select 1 from tracking_state t where t.user_id=${userId} and t.media_id=w.id and t.watchlist and not t.dropped)
    or exists(select 1 from up_next n where n.user_id=${userId} and n.media_id=w.id)
    or (${options.category}='game' and (select g.status from game_playthroughs g where g.user_id=${userId} and g.game_id=w.id order by g.created_at desc,g.id desc limit 1)='planned')`;
  const available=sql`exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id
    where a.user_id=${viewerId} and c.user_id=${viewerId} and c.status='connected' and i.enabled and a.state='available' and
    (a.media_id=w.id or exists(select 1 from media_relationships r where r.parent_id=w.id and r.child_id=a.media_id and r.kind='contains')))`;
  const where=sql`w.category=${options.category} and social_visible(${userId}::uuid,${viewerId}::uuid,${options.view==='watching'?'progress':'collection'},${options.category})
    and (${options.scope}='all' or ${available}) and ${options.view==='watching'?sql`coalesce((${active}),false)`:sql`(${planned}) and not coalesce((${active}),false)`}`;
  const db=getDb();
  const [count]=await db.execute<{total:number}>(sql`select count(*)::int as total from works w where ${where}`);
  const {page,pages}=pagination(count.total,options.page);
  const rows=await db.execute<{id:string;available:boolean}>(sql`select w.id,${available} as available from works w where ${where} order by
    greatest((select max(g.updated_at) from game_playthroughs g where g.user_id=${userId} and g.game_id=w.id),
      (select p.updated_at from music_progress p where p.user_id=${userId} and p.track_id=w.id),
      (select t.updated_at from tracking_state t where t.user_id=${userId} and t.media_id=w.id)) desc nulls last,w.id
    limit ${PAGE_SIZE} offset ${(page-1)*PAGE_SIZE}`);
  const availability=new Map(Array.from(rows).map(row=>[row.id,row.available]));
  const cards=await workCards(userId,viewerId,Array.from(rows).map(row=>row.id));
  return {...options,page,pages,total:count.total,items:cards.map(card=>({...card,available:availability.get(('workId' in card ? card.workId : undefined)??card.id)??false}))};
}

/** Received recommendations outlive notification delivery; filter IDs before hydrating a page. */
async function recommendationProgress(userId:string,viewerId:string,options:import('$lib/progress').ProgressOptions):Promise<ProgressContent> {
  if(userId!==viewerId)throw new AppError(403,'Recommendations are private to their recipient.');
  const config=await getConfig();requireEnabledCategory(config,options.category);
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
