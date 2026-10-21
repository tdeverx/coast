import * as v from 'valibot';
import {and, eq, inArray, ne, sql} from 'drizzle-orm';
import {categoryEnabled} from '#lib/experimental.js';
import {progressExperimentSchema, type ProgressExperimentContent} from '#lib/progress-experiment.js';
import {progressOptionsSchema} from '#lib/progress.js';
import {collectionCTE,collectionRead,workCards} from '#lib/collection/query.server.js';
import {getFeatureConfig} from '../features';
import {getDb} from '../db';
import * as s from '../db/schema';
import {listCandidateIds} from './lists';
import {enabledCategories} from '../experimental';
import {decorateProgressCards, mediumProgressIds, readingProgressIds, screenProgressPlan} from './progress';
import {hasPermittedWorkSource} from './media';
import {viewingRecency} from './viewing-recency';
import {rewatchBoundary} from '#lib/core/tracking/rewatch.server.js';
import {pagination, PAGE_SIZE} from './pagination';
import {ROW_BATCH_SIZE} from '#lib/page-window.js';
import {libraryTrackingCondition} from './library';

/** Dev-only caller: select eligible IDs across enabled media before hydrating one page. */
export async function progressExperimentData(userId:string, raw:unknown, {preview=false,signal,viewerId=userId}:{preview?:boolean;signal?:AbortSignal;viewerId?:string}={}):Promise<ProgressExperimentContent> {
  signal?.throwIfAborted();
  const options=v.parse(progressExperimentSchema,raw),config=await getFeatureConfig(viewerId);
  signal?.throwIfAborted();
  const saved=options.view==='watchlist'||options.view==='favourites';
  const history=options.view==='finished'||options.view==='dropped';
  const view=options.view==='continue'?'watching':'up-next';
  const base=v.parse(progressOptionsSchema,{view,scope:options.scope});
  const wants=(category:string)=>!saved&&!history&&categoryEnabled(config,category)&&(options.kind==='all'||(category==='screen'?['movie','show'].includes(options.kind):category==='reading'?['book','comic'].includes(options.kind):options.kind==='game'));
  const [screen,games,reading]=await Promise.all([
    wants('screen')?screenProgressPlan(userId,base,viewerId,{firstEpisode:options.view==='next',sortByActivity:false}):undefined,
    wants('game')?mediumProgressIds(userId,{...base,category:'game'},false,viewerId):[],
    wants('reading')?readingProgressIds(userId,{...base,category:'reading'},false,viewerId):[],
  ]);
  signal?.throwIfAborted();
  const historyRows=history?await collectionRead(sql`${collectionCTE(userId,viewerId,'all','personal')}
    select a.id from assessments a left join ${s.media} on ${s.media.id}=a.id
    left join ${s.trackingState} on ${s.trackingState.mediaId}=a.id and ${s.trackingState.userId}=${userId}
    where a.category<>'music' and case when a.category='screen' then
      ${options.view==='finished'?sql`a.kind in ('movie','show')`:sql`a.kind in ('movie','show','season','episode','collection')`}
      and ${libraryTrackingCondition(userId,options.view==='finished'?'watched':'dropped')}
      else ${options.view==='finished'?sql`a.completed and not a.dropped`:sql`a.dropped`} end`):[];
  const candidates=history?historyRows.map(row=>row.id as string):saved?await listCandidateIds(userId,{view:options.view,category:'all',filter:'to-watch',scope:options.scope,kind:options.kind},viewerId):[...new Set([...(screen?.allIds??[]),...games,...reading])];
  signal?.throwIfAborted();
  if(!candidates.length)return {...options,items:[],total:0,page:1,pages:1};
  const available=hasPermittedWorkSource(viewerId);
  const section=saved?options.view==='favourites'?'favourites':'collection':'progress';
  const where=and(
    sql`${s.works.id}=any(${`{${candidates.join(',')}}`}::uuid[])`,enabledCategories(sql`${s.works.category}`,config),
    ne(s.works.category,'music'),
    sql`social_visible(${userId}::uuid,${viewerId}::uuid,${section},${s.works.category})`,
    options.view==='next'?sql`social_visible(${userId}::uuid,${viewerId}::uuid,'collection',${s.works.category})`:undefined,
    options.kind==='all'?undefined:options.kind==='show'?inArray(s.works.kind,['show','season','episode']):eq(s.works.kind,options.kind),
    options.scope==='available'?available:undefined,
  );
  const [count]=await getDb().select({total:sql<number>`count(*)::int`}).from(s.works)
    .leftJoin(s.media,eq(s.media.id,s.works.id)).where(where);
  signal?.throwIfAborted();
  const pageSize=preview?ROW_BATCH_SIZE:PAGE_SIZE;
  const {page,pages}=pagination(count.total,options.page,pageSize);
  if(!count.total)return {...options,items:[],total:0,page,pages};
  // Row previews consume twenty cards; expanded pages retain the shared sixty-card boundary.
  const visible=await getDb().select({id:s.works.id,available:sql<boolean>`${available}`}).from(s.works)
    .leftJoin(s.media,eq(s.media.id,s.works.id)).where(where)
    .orderBy(saved
      ? sql`(select t.updated_at from tracking_state t where t.user_id=${userId} and t.media_id=${s.works.id}) desc nulls last`
      : sql`greatest(
        case when ${s.works.category}='screen' then greatest(${rewatchBoundary(userId,sql`${s.works.id}`)},${viewingRecency(userId,sql`coalesce((select e.show_id from episodes e where e.media_id=${s.works.id}),${s.works.id})`)})
        else greatest(
          (select max(g.updated_at) from game_playthroughs g where g.user_id=${userId} and g.game_id=${s.works.id}),
          (select p.updated_at from reading_progress p where p.user_id=${userId} and p.work_id=${s.works.id})
        ) end,
        case when ${options.view}='next' then (select n.created_at from up_next n where n.user_id=${userId} and n.media_id=${s.works.id}) end,
        ${history?sql`(select t.updated_at from tracking_state t where t.user_id=${userId} and t.media_id=${s.works.id})`:sql`null::timestamptz`}
      ) desc nulls last`,s.works.id).limit(pageSize).offset((page-1)*pageSize);
  signal?.throwIfAborted();
  let items=await workCards(userId,viewerId,visible.map(row=>row.id));
  signal?.throwIfAborted();
  const readingIds=items.filter(item=>item.kind==='book'||item.kind==='comic').map(item=>item.id);
  if(readingIds.length){
    // Use verified, already-saved containers for this page; never fetch a provider per card.
    const groups=await getDb().selectDistinctOn([s.readingGroupMembers.workId],{workId:s.readingGroupMembers.workId,id:s.readingGroups.id,title:s.readingGroups.title})
      .from(s.readingGroupMembers).innerJoin(s.readingGroups,eq(s.readingGroups.id,s.readingGroupMembers.groupId))
      .where(sql`${s.readingGroupMembers.workId}=any(${`{${readingIds.join(',')}}`}::uuid[])`).orderBy(s.readingGroupMembers.workId,s.readingGroups.title,s.readingGroups.id);
    signal?.throwIfAborted();
    const byWork=new Map<string,typeof groups[number]>();
    for(const group of groups)if(!byWork.has(group.workId))byWork.set(group.workId,group);
    items=items.map(item=>{
      const group=byWork.get(item.id);
      return group?{...item,captionSubtitle:group.title,captionSubtitleHref:`/media/reading-collection/${group.id}`}:item;
    });
  }
  const availability=new Map(visible.map(row=>[row.id,row.available]));
  for(const item of items)item.available=availability.get(('workId' in item?item.workId:undefined)??item.id)??false;
  if(screen||history){
    const screenItems=items.filter((item):item is import('#lib/ui/types.js').MediaView=>!('href' in item));
    decorateProgressCards(screenItems,screen?.sequenceById??new Map(),history?options.view:view);
    const decorated=new Map(screenItems.map(item=>[item.id,item]));
    items=items.map(item=>decorated.get(item.id)??item);
  }
  return {...options,items,total:count.total,page,pages};
}
