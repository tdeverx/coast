import {getSql} from '#lib/server/db/index.js';
import {tasteRootJoin} from '#lib/social/taste-root.server.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {ratingVote,type FriendTasteAdjustment} from '#lib/social/taste-rating-model.js';

type FriendTasteEvidence = { rating: number | null; shared: number; difference: number };

/** Compare stated preferences; an unrated watch supplies a small positive signal. */
export function friendTasteAdjustment(evidence: readonly FriendTasteEvidence[]): FriendTasteAdjustment {
  let support=0, votes=0, watched=0, rated=0;
  for (const {rating,shared,difference} of evidence) {
    const agreement=1-difference/4.5;
    if (shared<8 || agreement<0.8) continue;
    const trust=(agreement-0.75)*4*shared/(shared+8);
    support+=trust;
    votes+=trust*(rating===null ? 0.25 : ratingVote(rating));
    watched++;
    if(rating!==null)rated++;
  }
  const adjustment=6*votes/(0.75+support);
  const rounded=Math.round(Math.abs(adjustment));
  return {watched,rated,points:rounded ? Math.sign(adjustment)*rounded : 0};
}

/** Reproduce the incumbent inspector on visible data for historical comparisons. */
export async function visibleFriendTaste(viewer:string,workIds:string[]):Promise<Map<string,FriendTasteAdjustment>> {
 if(!workIds.length)return new Map();
 const sql=getSql();
 const rows=await trackReadQuery(()=>sql<(FriendTasteEvidence & {workId:string})[]>`
  with targets as materialized (
   select w.id,w.kind,w.category,root.id as root_id,root.kind as root_kind from works w ${tasteRootJoin(sql)}
   where w.id=any(${sql.array(workIds,'UUID')}::uuid[]) and w.kind in ('movie','show','game','album','track','book','comic')
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
   select target.id,target.root_id,target.root_kind,f.id as friend_id,r.value as rating
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
  ), shared as (
   -- Intersect visible ratings first. A long show or an album gets one vote in agreement.
   select f.friend_id,root.kind,root.id,max(least(own.updated_at,other.updated_at)) as recency,
    coalesce(max(abs(own.value-other.value)) filter(where own.media_id=root.id),
     avg(abs(own.value-other.value))) as difference
   from (select distinct friend_id,root_kind from watched) f
   join ratings other on other.user_id=f.friend_id
   join ratings own on own.media_id=other.media_id and own.user_id=${viewer}::uuid
   join works w on w.id=own.media_id ${tasteRootJoin(sql)}
   where root.kind=f.root_kind and (own.value<>3 or other.value<>3)
   group by f.friend_id,root.kind,root.id
  ), recent as materialized (
   -- One spare row lets every target exclude itself without changing other targets' samples.
   select * from (select shared.*,row_number() over(partition by friend_id,kind order by recency desc,id) as ordinal
    from shared) ordered where ordinal<=121
  ), ranked as (
   select w.id as "workId",w.rating,a.shared,a.difference,
    row_number() over(partition by w.id order by a.difference,a.shared desc,w.friend_id) as position
   from watched w cross join lateral (
    select count(*)::int as shared,avg(s.difference)::float8 as difference from (
     select difference from recent where friend_id=w.friend_id and kind=w.root_kind and id<>w.root_id
     order by ordinal limit 120
    ) s having count(*)>=8 and avg(s.difference)<=0.9
   ) a
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
