import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
export type DynamicRow = {key:string;title:string;category:'screen'|'game'|'music';genre:string};
/** Row definitions are cheap; each Shelf fetches its own bounded card page on demand. */
export async function dynamicFeed(userId:string,url:URL) {
 const config=await getConfig();
 if(!config.experimentalDynamicForYou)throw new AppError(404,'This experiment is disabled.');
 const offset=v.parse(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(10000)),Number(url.searchParams.get('offset')??0));
 const db=getSql();
 const rows=await db<{category:DynamicRow['category'];genre:string}[]>`with personal as (
  select media_id as id,updated_at as updated from tracking_state where user_id=${userId} and not dropped and (watched or favourite or watchlist)
  union all select media_id,updated_at from ratings where user_id=${userId} and value>=3.5
  union all select game_id,updated_at from game_playthroughs where user_id=${userId} and status<>'dropped'
  union all select track_id,occurred_at from music_listens where user_id=${userId}
  union all select track_id,updated_at from music_progress where user_id=${userId} and (position_seconds>0 or play_count>0)
 ), recent as (
  select id,max(updated) as updated from personal group by id order by updated desc,id limit 300
 ), seeds as (
  select w.category,coalesce(m.genres,g.genres,a.genres,'{}'::text[]) as genres,p.updated
  from recent p join works w on w.id=p.id left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id
  where w.kind in ('movie','show','game','album','track') and (w.category='screen' or ${config.experimentalFeatures})
 ), genres as (
  select category,genre,max(updated) as updated from seeds cross join lateral unnest(genres) genre
  where length(trim(genre)) between 1 and 100 group by category,genre
 ), ranked as (
  select category,genre,row_number() over(partition by category order by updated desc,genre) as rank from genres
 ) select category,genre from ranked order by rank,category limit 4 offset ${offset}`;
 const items:DynamicRow[]=rows.slice(0,3).map(row=>({key:`${row.category}:${row.genre}`,category:row.category,genre:row.genre,title:`${row.genre} to ${row.category==='screen'?'watch':row.category==='game'?'play':'listen to'}`}));
 return {rows:items,nextOffset:rows.length>3?offset+3:null};
}
