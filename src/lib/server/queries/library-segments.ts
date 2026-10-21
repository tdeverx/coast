import {sql,type SQLWrapper} from 'drizzle-orm';
import * as v from 'valibot';
import type {LibrarySegment} from '#lib/library.js';
import {progressOptionsSchema} from '#lib/progress.js';
import {screenProgressPlan,mediumProgressIds,readingProgressIds} from './progress';
import {libraryTrackingCondition} from './library';

/** Apply personal segments before counting/paging; share the Progress continuation planner. */
export async function librarySegmentCondition(ownerId:string,viewerId:string,segment:LibrarySegment,id:SQLWrapper,category:'screen'|'game'|'reading'|'music'){
  if(segment==='all')return;
  const visible=(section:string)=>sql`social_visible(${ownerId}::uuid,${viewerId}::uuid,${section},(select w.category from works w where w.id=${id}))`;
  if(segment==='later'||segment==='favourites')return sql`${visible(segment==='later'?'collection':'favourites')} and exists(select 1 from tracking_state saved where saved.user_id=${ownerId} and saved.media_id=${id} and ${segment==='later'?sql`saved.watchlist`:sql`saved.favourite`})`;
  if(category==='music')return sql`false`;
  if(segment==='continue'||segment==='next'){
    const options=v.parse(progressOptionsSchema,{view:segment==='continue'?'watching':'up-next',category:category==='reading'?'reading':category,scope:'all'});
    const ids=category==='screen'?(await screenProgressPlan(ownerId,options,viewerId,{firstEpisode:segment==='next',sortByActivity:false})).allIds
      :category==='game'?await mediumProgressIds(ownerId,options,false,viewerId):await readingProgressIds(ownerId,options,false,viewerId);
    const candidates=sql`${`{${ids.join(',')}}`}::uuid[]`;
    return sql`${visible('progress')} and (${id}=any(${candidates}) or exists(select 1 from episodes e where e.show_id=${id} and e.media_id=any(${candidates})) or exists(select 1 from seasons season where season.show_id=${id} and season.media_id=any(${candidates})))`;
  }
  if(category==='screen')return sql`${visible('progress')} and exists(select 1 from media segment_media left join tracking_state segment_tracking on segment_tracking.media_id=segment_media.id and segment_tracking.user_id=${ownerId} where segment_media.id=${id} and ${libraryTrackingCondition(ownerId,segment==='finished'?'watched':segment,{id:sql`segment_media.id`,kind:sql`segment_media.kind`,state:sql`segment_tracking`,dropped:sql`segment_tracking.dropped`})})`;
  const state=category==='game'?sql`(select p.status from game_playthroughs p where p.game_id=${id} and p.user_id=${ownerId} order by p.created_at desc,p.id desc limit 1)`
    :sql`(select p.state from reading_progress p where p.work_id=${id} and p.user_id=${ownerId})`;
  return sql`${visible('progress')} and ${segment==='unwatched'?sql`coalesce(${state}<>'completed',true)`:sql`${state}=${segment==='finished'?'completed':'dropped'}`}`;
}
