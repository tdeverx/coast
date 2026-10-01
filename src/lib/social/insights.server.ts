import {getSql} from '$lib/server/db';
import {requireFriend} from './service.server';
import {requireVisible} from './privacy.server';
import {median,tasteSignals,type TasteWork} from './taste';
export async function friendInsights(viewerId:string,friendId:string) {
 await requireFriend(viewerId,friendId);await requireVisible(friendId,viewerId,'insights');
 const rows=await getSql()`select u.id as "userId",w.id,case when w.kind='movie' then 'movies' when w.category='screen' then 'tv' else w.category end as medium,
 coalesce(m.genres,mu.genres,g.genres,'{}'::text[]) as genres,
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then coalesce(t.position_seconds,mp.position_seconds,0) else 0 end as "positionSeconds",
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then coalesce(t.duration_seconds,mp.duration_seconds,0) else 0 end as "durationSeconds",
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then gp.progress_percent end as "gameProgress",
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then gp.status end as "gameStatus",
 case when social_visible(u.id,${viewerId}::uuid,'ratings',w.category) then r.value end as rating,
 case when social_visible(u.id,${viewerId}::uuid,'reactions',w.category) then reaction.emoji end as reaction,
 (social_visible(u.id,${viewerId}::uuid,'collection',w.category) and (coalesce(t.collected,false) or coalesce(t.watchlist,false))) or (social_visible(u.id,${viewerId}::uuid,'favourites',w.category) and coalesce(t.favourite,false)) as interest,
 social_visible(u.id,${viewerId}::uuid,'activity',w.category) and (coalesce(t.watched,false) or coalesce(t.play_count,0)>0 or exists(select 1 from music_listens where user_id=u.id and track_id=w.id) or exists(select 1 from game_playthroughs where user_id=u.id and game_id=w.id and status='completed')) as consumed
 from users u cross join works w left join media m on m.id=w.id left join music_works mu on mu.id=w.id left join games g on g.id=w.id
 left join music_progress mp on mp.user_id=u.id and mp.track_id=w.id
 left join lateral(select progress_percent,status from game_playthroughs where user_id=u.id and game_id=w.id order by created_at desc,id desc limit 1) gp on true
 left join tracking_state t on t.user_id=u.id and t.media_id=w.id left join ratings r on r.user_id=u.id and r.media_id=w.id
 left join social_reactions reaction on reaction.user_id=u.id and reaction.target_kind='work' and reaction.target_id=w.id
 where u.id in (${viewerId},${friendId}) and not u.disabled and (w.category='screen' or coalesce((select value->>'experimentalFeatures' from system_settings where key='coast'),'false')='true')
 and (t.collected or t.watchlist or t.favourite or t.watched or t.play_count>0 or r.value is not null or reaction.emoji is not null or exists(select 1 from music_listens where user_id=u.id and track_id=w.id) or coalesce(t.position_seconds,mp.position_seconds,0)>0 or gp.status in ('in-progress','paused','completed','dropped'))`;
 const media=['movies','tv','music','game'].map(medium=>{
  type ComparedWork=TasteWork&{positionSeconds:number;durationSeconds:number;gameProgress:number|null;gameStatus:string|null};
  const left=rows.filter((r:any)=>r.medium===medium&&r.userId===viewerId) as ComparedWork[],right=rows.filter((r:any)=>r.medium===medium&&r.userId===friendId) as ComparedWork[];
  const meaningful=(r:ComparedWork)=>r.rating!=null||r.reaction||r.interest||r.consumed||r.positionSeconds>0||['in-progress','paused','dropped'].includes(r.gameStatus??'');
  const a=left.filter(meaningful),b=right.filter(meaningful),ids=new Set(b.map(r=>r.id));
  const stats=(items:ComparedWork[])=>({total:items.length,completed:items.filter(w=>w.consumed).length,planned:items.filter(w=>w.interest&&!w.consumed&&!w.positionSeconds).length,active:items.filter(w=>!w.consumed&&(w.positionSeconds>0||w.gameStatus==='in-progress'||w.gameStatus==='paused')).length,rated:items.filter(w=>w.rating!=null).length,reacted:items.filter(w=>w.reaction).length});
  const progress=(w:ComparedWork)=>w.consumed?100:w.gameProgress??(w.durationSeconds?Math.min(100,100*w.positionSeconds/w.durationSeconds):null);
  const progressComparisons=a.flatMap(w=>{const friend=b.find(other=>other.id===w.id);return friend?[{workId:w.id,you:progress(w),friend:progress(friend)}]:[];});
  return {medium,...tasteSignals(a,b),stats:{you:stats(a),friend:stats(b)},progressComparisons,overlap:{shared:a.filter(r=>ids.has(r.id)).map(r=>r.id),onlyYou:a.filter(r=>!ids.has(r.id)).map(r=>r.id),onlyFriend:b.filter(r=>!a.some(w=>w.id===r.id)).map(r=>r.id)}};
 });
 return {friendId,score:median(media.flatMap(m=>m.score===null?[]:[m.score])),media};
}
export async function friendDiscovery(viewerId:string) {
 return getSql()`select a.work_id as "workId",count(distinct a.user_id)::int as friends,max(a.occurred_at) as "discoveredAt" from social_activity a join works w on w.id=a.work_id
 where a.occurred_at>=now()-interval '30 days' and a.date_known and social_visible(a.user_id,${viewerId}::uuid,a.section,w.category)
 and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(a.user_id,${viewerId}::uuid) and f.user_b=greatest(a.user_id,${viewerId}::uuid))
 group by a.work_id order by count(distinct a.user_id) desc,max(a.occurred_at) desc,a.work_id limit 60`;
}
