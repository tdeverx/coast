import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {friendTasteAdjustment, type FriendTasteEvidence, type FriendTasteAdjustment} from './taste-rating-model';

/** Live input for explicit score calculations. Friend activity never enters a cached score. */
export async function visibleFriendTaste(viewer:string,workIds:string[]):Promise<Map<string,FriendTasteAdjustment>> {
 if(!workIds.length)return new Map();
 const sql=getSql();
 const rows=await trackReadQuery(()=>sql<(FriendTasteEvidence & {workId:string})[]>`
  with targets as materialized (
   select id,kind,category from works where id=any(${sql.array(workIds,'UUID')}::uuid[])
    and kind in ('movie','show','game','album','track','book','comic')
  ), friends as materialized (
   select u.id,c.category
   from (
    select user_b as id from friendships where user_a=${viewer}::uuid and state='accepted'
    union all
    select user_a from friendships where user_b=${viewer}::uuid and state='accepted'
   ) f join users u on u.id=f.id cross join (select distinct category from targets) c
   where coast_feature_enabled(${viewer}::uuid,'social') and coast_feature_enabled(${viewer}::uuid,'personalisation')
    and coast_feature_enabled(u.id,'social') and coast_feature_enabled(u.id,'personalisation')
    and social_visible(u.id,${viewer}::uuid,'insights',c.category)
    and social_visible(u.id,${viewer}::uuid,case when c.category in ('book','comic') then 'progress' else 'activity' end,c.category)
    and social_visible(u.id,${viewer}::uuid,'ratings',c.category)
  ), watched as materialized (
   select target.id,target.kind,f.id as friend_id,r.value as rating
   from friends f join targets target using(category)
   left join ratings r on r.user_id=f.id and r.media_id=target.id
   where case target.kind
    when 'game' then exists(select 1 from game_playthroughs p where p.user_id=f.id and p.game_id=target.id
     and (p.status='completed' or p.progress_percent>0 or exists(select 1 from game_sessions s where s.playthrough_id=p.id)))
    when 'book' then exists(select 1 from reading_progress p where p.user_id=f.id and p.work_id=target.id and p.state='completed')
    when 'comic' then exists(select 1 from reading_progress p where p.user_id=f.id and p.work_id=target.id and p.state='completed')
    when 'track' then exists(select 1 from music_listens l where l.user_id=f.id and l.track_id=target.id)
     or exists(select 1 from music_progress p where p.user_id=f.id and p.track_id=target.id and p.play_count>0)
    when 'album' then exists(select 1 from media_relationships m where m.parent_id=target.id and m.kind='contains' and (
     exists(select 1 from music_listens l where l.user_id=f.id and l.track_id=m.child_id)
     or exists(select 1 from music_progress p where p.user_id=f.id and p.track_id=m.child_id and p.play_count>0)))
    else exists(select 1 from tracking_state t where t.user_id=f.id and t.media_id=target.id
     and (t.watched or t.play_count>0 or t.completed_episodes>0)) end
  ), sample as materialized (
   select kinds.kind,s.media_id,s.value
   from (select distinct kind from watched) kinds
   cross join lateral (
    select r.media_id,r.value from ratings r join works w on w.id=r.media_id and w.kind=kinds.kind
    where r.user_id=${viewer}::uuid and not exists(select 1 from targets where id=r.media_id)
    order by r.updated_at desc,r.media_id limit 120
   ) s
  ), agreement as (
   select f.friend_id,f.kind,count(*)::int as shared,avg(abs(s.value-r.value))::float8 as difference
   from (select distinct friend_id,kind from watched) f join sample s on s.kind=f.kind
   join ratings r on r.user_id=f.friend_id and r.media_id=s.media_id
   where s.value<>3 or r.value<>3
   group by f.friend_id,f.kind
   having count(*)>=8 and avg(abs(s.value-r.value))<=0.9
  ), ranked as (
   select w.id as "workId",w.rating,a.shared,a.difference,
    row_number() over(partition by w.id order by a.difference,a.shared desc,a.friend_id) as position
   from watched w join agreement a on a.friend_id=w.friend_id and a.kind=w.kind
  )
  select "workId",rating,shared,difference from ranked where position<=24`);
 const evidence=new Map<string,FriendTasteEvidence[]>();
 for(const {workId,...row} of rows){
  const entries=evidence.get(workId);
  if(entries)entries.push(row);
  else evidence.set(workId,[row]);
 }
 return new Map([...evidence].map(([id,entries])=>[id,friendTasteAdjustment(entries)]));
}
