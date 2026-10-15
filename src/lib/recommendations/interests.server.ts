import {getSql} from '$lib/server/db/index';
import type {DynamicMedium,DynamicKind} from './model';
export type InterestWork={id:string;category:DynamicMedium;kind:DynamicKind|'track';title:string;genres:string[];weight:number;consumed:boolean;positive:boolean;updated:Date|string};
/** Collapse episodes to their show and cap each work's influence; imports are not thousands of votes. */
export async function interestWorks(userId:string|null){
 return getSql()<InterestWork[]>`with signals as (
  select t.user_id,t.media_id as id,t.updated_at as updated,
   case when t.dropped then -6 when t.favourite then 5 when t.watched then 3 else 1 end::float as weight,
   t.watched as consumed,t.favourite as positive
  from tracking_state t join users u on u.id=t.user_id and not u.disabled where (${userId}::uuid is null or t.user_id=${userId}) and (t.dropped or t.watched or t.favourite or t.watchlist)
  union all select p.user_id,p.work_id,p.updated_at,case when p.state='dropped' then -6 when p.state='completed' then 3 when p.state='reading' then 2 else 1 end,p.state='completed',false from reading_progress p join users u on u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId})
  union all select r.user_id,r.media_id,r.updated_at,case when r.value<2.5 then -5 when r.value>=3.5 then 5 else 0 end,false,r.value>=3.5 from ratings r join users u on u.id=r.user_id and not u.disabled where (${userId}::uuid is null or r.user_id=${userId})
  union all select p.user_id,p.game_id,p.updated_at,case when p.status='dropped' then -6 when p.status='completed' then 3 when p.status='in-progress' then 2 else 1 end,p.status='completed',false from (select distinct on(user_id,game_id) * from game_playthroughs where (${userId}::uuid is null or user_id=${userId}) order by user_id,game_id,created_at desc,id desc) p join users u on u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId})
  union all select p.user_id,p.track_id,p.updated_at,case when p.play_count>=3 then 4 when p.play_count>0 then 3 else 1 end,p.play_count>0,false from music_progress p join users u on u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId}) and (p.play_count>0 or p.position_seconds>0)
  union all select l.user_id,l.track_id,max(l.occurred_at),case when count(*)>=3 then 4 else 3 end,true,false from music_listens l join users u on u.id=l.user_id and not u.disabled where (${userId}::uuid is null or l.user_id=${userId}) group by l.user_id,l.track_id
  union all select r.user_id,r.target_id,r.updated_at,case when r.emoji in ('❤️','🔥') then 4 else 0 end,false,r.emoji in ('❤️','🔥') from social_reactions r join users u on u.id=r.user_id and not u.disabled where r.target_kind='work' and (${userId}::uuid is null or r.user_id=${userId})
 ), roots as (
  select coalesce(e.show_id,s.show_id,r.parent_id,p.id) as id,p.updated,p.weight,p.consumed,p.positive from signals p
  left join episodes e on e.media_id=p.id left join seasons s on s.media_id=p.id
  left join lateral(select parent_id from media_relationships r join works w on w.id=r.parent_id and w.kind='album' where r.child_id=p.id and r.kind='contains' order by position,parent_id limit 1) r on true
 ), recent as (
  select id,max(updated) as updated,case when ${userId}::uuid is null then max(weight) when min(weight)<0 then min(weight) else max(weight) end as weight,bool_or(consumed) as consumed,bool_or(positive) as positive from roots group by id order by max(updated) desc,id limit 300
 ) select w.id,case when w.category in ('book','comic') then 'reading' else w.category end as category,w.kind,coalesce(m.title,g.title,a.title,b.title) as title,coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]) as genres,p.weight,p.consumed,p.positive,p.updated from recent p join works w on w.id=p.id left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id where w.kind in ('movie','show','game','album','track','book','comic')`;
}
