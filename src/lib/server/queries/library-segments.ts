import {sql,type SQLWrapper} from 'drizzle-orm';
import * as v from 'valibot';
import type {LibrarySegment} from '#lib/library.js';
import {progressOptionsSchema} from '#lib/progress.js';
import {screenProgressPlan,mediumProgressIds,readingProgressIds} from './progress';
import {libraryTrackingCondition} from './library';
import {getDb} from '../db';

/** Apply personal segments before counting/paging; share the Progress continuation planner. */
export async function librarySegmentCondition(ownerId:string,viewerId:string,segment:LibrarySegment,id:SQLWrapper,category:'screen'|'game'|'reading'|'music'){
  if(segment==='all')return;
  const visible=(section:string)=>sql`social_visible(${ownerId}::uuid,${viewerId}::uuid,${section},(select w.category from works w where w.id=${id}))`;
  if(segment==='later'||segment==='favourites')return sql`${visible(segment==='later'?'collection':'favourites')} and exists(select 1 from tracking_state saved where saved.user_id=${ownerId} and saved.media_id=${id} and ${segment==='later'?sql`saved.watchlist`:sql`saved.favourite`})`;
  if(category==='music')return sql`false`;
  if(segment==='continue'||segment==='next'){
    const options=v.parse(progressOptionsSchema,{view:segment==='continue'?'watching':'up-next',category:category==='reading'?'reading':category,scope:'all'});
    const ids=category==='screen'?(await screenProgressPlan(ownerId,options,viewerId,{firstEpisode:segment==='next',sortByActivity:false})).allIds
      :category==='game'?await mediumProgressIds(ownerId,options,viewerId):await readingProgressIds(ownerId,options,viewerId);
    if(!ids.length)return sql`false`;
    const candidates=sql`${`{${ids.join(',')}}`}::uuid[]`;
    // The page query can use the resulting IDs directly. Keep visibility in that query.
    const parents=await getDb().execute<{id:string}>(sql`
      select show_id as id from episodes where media_id=any(${candidates})
      union select show_id as id from seasons where media_id=any(${candidates})
    `);
    const roots=[...new Set([...ids,...Array.from(parents,row=>row.id)])];
    return sql`${id}=any(${`{${roots.join(',')}}`}::uuid[]) and ${visible('progress')}`;
  }
  if(category==='screen')return sql`${visible('progress')} and exists(select 1 from media segment_media left join tracking_state segment_tracking on segment_tracking.media_id=segment_media.id and segment_tracking.user_id=${ownerId} where segment_media.id=${id} and ${libraryTrackingCondition(ownerId,segment==='finished'?'watched':segment,{id:sql`segment_media.id`,kind:sql`segment_media.kind`,state:sql`segment_tracking`,dropped:sql`segment_tracking.dropped`})})`;
  const state=category==='game'?sql`(select p.status from game_playthroughs p where p.game_id=${id} and p.user_id=${ownerId} order by p.created_at desc,p.id desc limit 1)`
    :sql`(select p.state from reading_progress p where p.work_id=${id} and p.user_id=${ownerId})`;
  return sql`${visible('progress')} and ${segment==='unwatched'?sql`coalesce(${state}<>'completed',true)`:sql`${state}=${segment==='finished'?'completed':'dropped'}`}`;
}
