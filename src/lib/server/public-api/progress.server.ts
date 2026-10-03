import { getDb } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import type { MediaView,MediaCardPresentation } from '$lib/ui/types';
import { publicWork } from './response';

/** Hydrate concrete activity for just the already filtered page; never export private notes. */
export async function publicProgress(userId:string,items:(MediaView|MediaCardPresentation)[]) {
 const ids=[...new Set(items.filter(item=>item.kind==='game'||item.kind==='track'||item.kind==='album').map(item=>('workId' in item?item.workId:undefined)??item.id))];
 if(!ids.length)return items.map(item=>publicWork(item,true));
 const rows=await getDb().execute<{id:string;music:unknown;game:unknown;relationships:unknown}>(sql`
   select w.id,
     (select jsonb_build_object('positionSeconds',p.position_seconds,'durationSeconds',p.duration_seconds,'playCount',p.play_count)
       from music_progress p where p.track_id=w.id and p.user_id=${userId}) as music,
     (select jsonb_build_object('status',g.status,'progressPercent',g.progress_percent,'repeat',g.repeat,'startedAt',g.started_at,'completedAt',g.completed_at,
       'minutesPlayed',coalesce((select sum(gs.minutes_played) from game_sessions gs where gs.playthrough_id=g.id),0))
       from game_playthroughs g where g.game_id=w.id and g.user_id=${userId} order by g.created_at desc,g.id desc limit 1) as game,
     (select jsonb_build_object('collected',t.collected,'watchlist',t.watchlist,'favourite',t.favourite,'dropped',t.dropped)
       from tracking_state t where t.media_id=w.id and t.user_id=${userId}) as relationships
   from works w where w.id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`);
 const state=new Map(Array.from(rows).map(row=>[row.id,row]));
 return items.map(item=>{const result=publicWork(item,true),row=state.get(result.id);return {...result,...(row?{relationships:row.relationships??null,...(item.kind==='game'?{game:row.game??null}:{music:row.music??null})}:{})};});
}
