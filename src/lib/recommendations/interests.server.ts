import {getSql} from '#lib/server/db/index.js';
import type {TasteMedium,TasteWorkEvidence} from '#lib/social/taste-profile.js';
import type {DynamicMedium,DynamicKind} from './model';
export type InterestWork={id:string;category:DynamicMedium;kind:DynamicKind|'track';title:string;genres:string[];weight:number;consumed:boolean;positive:boolean;updated:Date|string};
type TasteHistoryWork=TasteWorkEvidence & {
 id:string;medium:TasteMedium;
 ratingCount:number;medianRating:number|null;
};

/** Keep explicit opinions separate from behavior until each canonical work has one vote. */
function interestQuery(userId:string|null,category:DynamicMedium|undefined,tasteCategories?:string[]){
 const sql=getSql();
 const screenHistory=tasteCategories?.includes('screen');
 const playCount=screenHistory
  ?sql`case when h.plays is null then t.play_count else greatest(h.plays,least(t.play_count,coalesce(j.plays,0))) end`
  :sql`t.play_count`;
 return sql<InterestWork[]>`with ${screenHistory?sql`
 screen_watches as materialized (
  select media_id,max(latest) as updated,
   greatest(coalesce(sum(plays) filter(where instant is not null),0),coalesce(max(plays) filter(where instant is null),0)) as plays
  from (
   -- Pair Trakt and Jellyfin observations, retaining separate plays in one source.
   select media_id,instant,max(latest) as latest,
    case when instant is null then max(plays)
     else coalesce(max(plays) filter(where source in ('jellyfin','trakt')),0)
      + coalesce(sum(plays) filter(where source not in ('jellyfin','trakt')),0)
    end as plays
   from (
    select media_id,case when occurred_at_known then occurred_at end as instant,source,max(occurred_at) as latest,count(*) as plays
    from (
     -- No-op admission follows application order. The date the user supplies can
     -- precede an unwatch that was actually applied before this watch.
     select media_id,source,occurred_at,occurred_at_known,action,rewatch,
      lag(action) over(partition by media_id order by created_at,id) as previous_action
     from tracking_events where user_id=${userId} and applied and action in ('watch','unwatch') and (action='unwatch' or value is distinct from false)
    ) e where e.action='watch' and (e.rewatch or e.previous_action is distinct from 'watch')
    group by media_id,instant,source
   ) by_source group by media_id,instant
  ) by_instant group by media_id
 ), jellyfin_plays as (
  -- An accepted Jellyfin count may include earlier watches without dates.
  select a.media_id,max((a.source->'coastUserData'->>'playCount')::int) as plays
  from availability a
  join provider_connections c on c.id=a.connection_id
  join provider_instances i on i.id=c.instance_id and i.provider='jellyfin'
  where a.user_id=${userId} and c.status='connected' and i.enabled and a.state='available'
    and jsonb_typeof(a.source->'coastUserData'->'playCount')='number'
  group by a.media_id
 ),`:sql``}
 signals(user_id,id,updated,implicit,consumed,explicit,rating,experienced,repeated,minutes) as (
  select t.user_id,t.media_id,t.updated_at,
   case when t.dropped then -2 when ${playCount}>1 then 4 when t.watched or ${playCount}>0 then 3
    when t.position_seconds>0 then 2 when t.watchlist then 1 else 0 end,
   t.watched,case when t.favourite then 5 else 0 end,null::float8,t.watched or ${playCount}>0,${playCount}>1,null::float8
  from tracking_state t join users u on coast_feature_enabled(u.id,'personalisation') and u.id=t.user_id and not u.disabled
  ${screenHistory?sql`
   left join screen_watches h on h.media_id=t.media_id
   left join jellyfin_plays j on j.media_id=t.media_id
  `:sql``}
  where (${userId}::uuid is null or t.user_id=${userId}) and (t.dropped or t.watched or t.favourite or t.watchlist or t.position_seconds>0 or t.play_count>0)
  union all select p.user_id,p.work_id,p.updated_at,
   case when p.state='dropped' then -2 when p.state='completed' then 3 when p.state in ('reading','paused') then 2 else 1 end,
   p.state='completed',0,null,p.state='completed' or p.page>0,false,null from reading_progress p join users u on coast_feature_enabled(u.id,'personalisation') and u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId})
  union all select r.user_id,r.media_id,r.updated_at,0,false,0,r.value,false,false,null from ratings r join users u on coast_feature_enabled(u.id,'personalisation') and u.id=r.user_id and not u.disabled where (${userId}::uuid is null or r.user_id=${userId})
  union all select p.user_id,p.game_id,p.updated_at,
   case when p.status='dropped' then -2 when p.status='completed' then 3 when p.status in ('in-progress','paused') then 2 else 1 end,
   p.status='completed',0,null,p.status='completed' or p.progress_percent>0,p.status='completed' and p.repeat,null
   from (select distinct on(user_id,game_id) * from game_playthroughs where (${userId}::uuid is null or user_id=${userId}) order by user_id,game_id,created_at desc,id desc) p
   join users u on coast_feature_enabled(u.id,'personalisation') and u.id=p.user_id and not u.disabled
  union all select c.user_id,g.game_id,max(coalesce(g.last_played_at,g.observed_at)),
   case when max(g.minutes_played)>=60 then 3 else 2 end,false,0,null,true,false,max(g.minutes_played)
  from game_account_state g join provider_connections c on c.sync_account_id=g.account_id and c.status='connected'
  join provider_instances i on i.id=c.instance_id and i.provider='steam' and i.enabled
  join users u on u.id=c.user_id and not u.disabled and coast_feature_enabled(u.id,'personalisation')
  where ${category??'all'} in ('all','game') and (${userId}::uuid is null or c.user_id=${userId}) and g.minutes_played>0
  group by c.user_id,g.game_id
  union all select p.user_id,p.track_id,p.updated_at,case when p.play_count>=3 then 4 when p.play_count>0 then 3 else 1 end,p.play_count>0,0,null,p.play_count>0,p.play_count>1,null
   from music_progress p join users u on coast_feature_enabled(u.id,'personalisation') and u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId}) and (p.play_count>0 or p.position_seconds>0)
  union all select l.user_id,l.track_id,max(l.occurred_at),case when count(*)>=3 then 4 else 3 end,true,0,null,true,count(*)>1,null
   from music_listens l join users u on coast_feature_enabled(u.id,'personalisation') and u.id=l.user_id and not u.disabled where (${userId}::uuid is null or l.user_id=${userId}) group by l.user_id,l.track_id
  union all select r.user_id,r.target_id,r.updated_at,0,false,case when r.emoji in ('❤️','🔥') then 4 else 0 end,null,false,false,null
   from social_reactions r join users u on coast_feature_enabled(u.id,'personalisation') and u.id=r.user_id and not u.disabled where coast_feature_enabled(r.user_id,'social') and r.target_kind='work' and (${userId}::uuid is null or r.user_id=${userId})
  ${screenHistory?sql`
   union all select ${userId}::uuid,h.media_id,h.updated,case when h.plays>1 then 4 else 3 end,true,0,null,true,h.plays>1,null
   from screen_watches h
  `:sql``}
  ${tasteCategories?sql`
   union all select h.user_id,h.work_id,max(h.occurred_at),max(case when h.state='completed' then 3 else 2 end),bool_or(h.state='completed'),0,null,
    true,count(*) filter(where h.state='completed')>1,null
   from reading_history h where h.user_id=${userId} and (h.state='completed' or h.page>0) group by h.user_id,h.work_id
   union all select p.user_id,p.game_id,max(p.completed_at),3,true,0,null,true,bool_or(p.repeat) or count(*)>1,null
   from game_playthroughs p where p.user_id=${userId} and p.status='completed' group by p.user_id,p.game_id
   union all select p.user_id,p.game_id,max(s.played_at),2,false,0,null,true,false,sum(s.minutes_played)
   from game_playthroughs p join game_sessions s on s.playthrough_id=p.id where p.user_id=${userId} group by p.user_id,p.game_id
  `:sql``}
 ), roots as (
  select coalesce(e.show_id,s.show_id,r.parent_id,p.id) as id,p.updated,p.id as source_id,p.implicit,p.explicit,p.rating,p.consumed,p.experienced,p.repeated,p.minutes,
   case when p.implicit<0 then -6 when p.rating is null then greatest(p.explicit,p.implicit)
    when p.rating<2.5 then -5 when p.rating>=3.5 then 5 else 0 end::float as weight,
   p.explicit>0 or coalesce(p.rating>=3.5,false) as positive
  from signals p join works admitted on admitted.id=p.id and ${tasteCategories?sql`admitted.category in (select category from unnest(${sql.array(tasteCategories,'TEXT')}::text[]) as permitted(category) where coast_category_enabled(${userId},category))`:sql`
    (${category??'all'}='all' or admitted.category=${category??'all'} or ${category??'all'}='reading' and admitted.kind in ('book','comic'))
    and coast_category_enabled(p.user_id,admitted.category)`}
  left join episodes e on e.media_id=p.id left join seasons s on s.media_id=p.id
  left join lateral(select parent_id from media_relationships r join works w on w.id=r.parent_id and w.kind='album' where e.show_id is null and s.show_id is null and r.child_id=p.id and r.kind='contains' order by position,parent_id limit 1) r on true
 ${tasteCategories?sql`
 ), estimates as (
  -- A direct title rating wins over its children. A dropped episode alone cannot undo seeing the rest of the show.
  select id,coalesce(max(rating) filter(where source_id=id),
    percentile_cont(0.5) within group(order by rating) filter(where rating is not null)) as rating,
   max(explicit) as explicit,coalesce(min(implicit) filter(where source_id=id and implicit<0),
    max(implicit) filter(where implicit>0),min(implicit)) as implicit,
   bool_or(experienced) as consumed,bool_or(repeated) as repeated,max(minutes) as minutes
  from roots group by id
 ), works_with_evidence as (
  select p.*,case when w.category='music' then 'music' else w.kind end as medium
  from estimates p join works w on w.id=p.id
  where w.kind in ('movie','show','game','album','track','book','comic','artist')
 ), baselines as (
  select medium,count(*)::int as rating_count,percentile_cont(0.5) within group(order by rating) as median_rating
  from works_with_evidence where rating is not null group by medium
 ), ranked_games as (
  -- Ties split the middle rank. Four neutral observations shrink short histories.
  select id,(2*(rank() over(order by minutes)-1)+count(*) over(partition by minutes)-count(*) over())::float8
   /(count(*) over()+4) as rank from works_with_evidence where medium='game' and minutes>0
 ) select w.id,w.medium,w.rating,w.explicit,w.implicit,w.consumed,w.repeated,
    coalesce(b.rating_count,0) as "ratingCount",b.median_rating as "medianRating",g.rank as "playtimeRank"
   from works_with_evidence w left join baselines b using(medium) left join ranked_games g using(id)
   where exists(select 1 from users u where u.id=${userId} and not u.disabled and coast_feature_enabled(u.id,'personalisation'))
 `:sql`
 ), grouped as (
  select id,max(updated) as updated,case when ${userId}::uuid is null then max(weight) when min(weight)<0 then min(weight) else max(weight) end as weight,bool_or(consumed) as consumed,bool_or(positive) as positive from roots group by id
  order by max(updated) desc,id limit 300
 ) select w.id,case when w.category in ('book','comic') then 'reading' else w.category end as category,w.kind,
  coalesce(m.title,g.title,a.title,b.title) as title,coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]) as genres,p.weight,p.consumed,p.positive,p.updated
  from grouped p join works w on w.id=p.id left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id
  where w.kind in ('movie','show','game','album','track','book','comic')`}`;
}

export async function interestWorks(userId:string|null,category?:DynamicMedium){
 return interestQuery(userId,category);
}

/** PostgreSQL groups the history once. The worker only hydrates one page of distinct roots at a time. */
export async function visitTasteHistory(userId:string,categories:string[],visit:(works:TasteHistoryWork[])=>Promise<void>){
 if(!categories.length)return;
 await getSql().begin('read only',async tx=>{
  await tx`declare coast_taste_history no scroll cursor for ${interestQuery(userId,undefined,categories)}`;
  while(true){
   const rows=await tx<TasteHistoryWork[]>`fetch forward 300 from coast_taste_history`;
   if(!rows.length)return;
   await visit(rows);
  }
 });
}

/** Consent fences a frozen provider batch; ordinary taste edits do not reorder it. */
export async function interestPolicyRevision(){
 const [row]=await getSql()`select md5(coalesce(string_agg(u.id::text||coalesce(u.settings->'features','{}'::jsonb)::text,',' order by u.id),'')||coalesce((select value->'features' from system_settings where key='coast'),'{}'::jsonb)::text) as revision from users u where not u.disabled`;
 return String(row.revision);
}
