import {getSql} from '#lib/server/db/index.js';
import type {TasteMedium,TasteWorkEvidence} from '#lib/social/taste-profile.js';
import type {DynamicMedium,DynamicKind} from './model';
import type {MetadataSource} from '#lib/catalogue/metadata/resolve.js';
import type {WorkKind} from '#lib/server/db/schema.js';
import {watchHabitsCtes} from './watch-habits.server';
export type InterestWork={id:string;category:DynamicMedium;kind:DynamicKind|'track';title:string;genres:string[];weight:number;consumed:boolean;positive:boolean;updated:Date|string};
type TasteHistoryWork=TasteWorkEvidence & {
 id:string;medium:TasteMedium;kind:WorkKind;
 ratingCount:number;medianRating:number|null;ratingReliability:number;chosen:boolean;
 lastExperiencedAt:Date|string|null;lastRatedAt:Date|string|null;childRatings:{id:string;rating:number}[]|null;
};

/** Resolve episode/season roots first. Album lookups use the first containing album in catalogue order. */
export function interestRootProjection(album: 'recorded' | 'lookup' | 'none') {
 const sql = getSql();
 return {
  id: sql`coalesce(e.show_id,s.show_id,${album === 'none' ? sql`null::uuid` : sql`r.parent_id`},p.id)`,
  albumJoin: album === 'recorded' ? sql`left join recorded_albums r on r.child_id=p.id`
   : album === 'none' ? sql`` : sql`left join lateral (
     select parent_id from media_relationships r join works w on w.id=r.parent_id and w.kind='album'
     where e.show_id is null and s.show_id is null and r.child_id=p.id and r.kind='contains'
     order by position,parent_id limit 1
    ) r on true`,
 };
}

/** A person's negative opinion survives merging child signals; a catalogue-wide seed can represent any supporter. */
export function groupedInterestRoots(userId: string | null) {
 const sql = getSql();
 return sql`select id,max(updated) as updated,
   case when ${userId}::uuid is null then max(weight) when min(weight)<0 then min(weight) else max(weight) end as weight,
   bool_or(consumed) as consumed,bool_or(positive) as positive
  from roots group by id`;
}

/** Keep explicit opinions separate from behavior until each canonical work has one vote. */
function interestQuery(userId:string|null,category:DynamicMedium|undefined,tasteCategories?:string[],metadataSource:MetadataSource='local-preferred',independentHabits=false){
 const sql=getSql();
 const screenHistory=tasteCategories?.includes('screen');
 const musicHistory=tasteCategories?.includes('music');
 const root=interestRootProjection(musicHistory?'recorded':tasteCategories?'none':'lookup');
 const repeated=screenHistory?sql`case when w.kind='show' then w.root_repeated or returns.root is not null else w.repeated end`:sql`w.repeated`;
 const playCount=screenHistory
  ?sql`case when h.plays is null then t.play_count else greatest(h.plays,least(t.play_count,coalesce(j.plays,0))) end`
  :sql`t.play_count`;
 return sql<InterestWork[]>`with ${screenHistory?sql`
 screen_watches as materialized (
  select media_id,max(latest) as updated,min(instant) as first_watch,max(instant) as last_watch,
   count(instant) as known_plays,
   greatest(coalesce(sum(plays) filter(where instant is not null),0),coalesce(max(plays) filter(where instant is null),0)) as plays
  from (
   -- Jellyfin repeats its last-played snapshot on reimport. Trakt can report
   -- distinct plays at the same instant, and Coast can record additional plays.
   select media_id,instant,max(latest) as latest,
    case when instant is null then max(plays)
     else coalesce(max(case when source='jellyfin' then 1 else plays end) filter(where source in ('jellyfin','trakt')),0)
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
  select a.media_id,max((a.source->'coastUserData'->>'playCount')::int)
    filter(where jsonb_typeof(a.source->'coastUserData'->'playCount')='number') as plays,
    min((item.snapshot->>'addedAt')::timestamptz)
    filter(where pg_input_is_valid(item.snapshot->>'addedAt','timestamptz')) as available_since
  from availability a
  join provider_items item on item.id=a.provider_item_id
  join provider_connections c on c.id=a.connection_id
  join provider_instances i on i.id=c.instance_id and i.provider='jellyfin'
  where a.user_id=${userId} and c.status='connected' and i.enabled and a.state='available'
  group by a.media_id
 ),${watchHabitsCtes(sql,userId!,metadataSource,independentHabits)}`:sql``}
 signals(user_id,id,updated,implicit,consumed,explicit,rating,experienced,repeated,minutes,completed,deliberate_return,chosen,known_at) as (
  select t.user_id,t.media_id,t.updated_at,
   case when t.dropped then -2 when ${playCount}>1 then 4 when t.watched or ${playCount}>0 then 3
    when t.position_seconds>0 then 2 when t.watchlist then 1 else 0 end,
   t.watched,case when t.favourite then 5 else 0 end,null::float8,t.watched or ${playCount}>0 or t.position_seconds>0,${playCount}>1,null::float8,null::boolean,false,
   t.watched or ${playCount}>0 or t.position_seconds>=least(1200,greatest(120,coalesce(t.duration_seconds*0.25,1200))),
   null::timestamptz
  from tracking_state t join users u on coast_feature_enabled(u.id,'personalisation') and u.id=t.user_id and not u.disabled
  ${screenHistory?sql`
   left join screen_watches h on h.media_id=t.media_id
   left join jellyfin_plays j on j.media_id=t.media_id
  `:sql``}
  where (${userId}::uuid is null or t.user_id=${userId}) and (t.dropped or t.watched or t.favourite or t.watchlist or t.position_seconds>0 or t.play_count>0)
  union all select p.user_id,p.work_id,p.updated_at,
   case when p.state='dropped' then -2 when p.state='completed' then 3 when p.state in ('reading','paused') then 2 else 1 end,
   p.state='completed',0,null,p.state='completed' or p.page>0,false,null,
   case when p.state='completed' then true when p.state='dropped' and p.page>0 then false end,false,
   p.state='completed' or p.page>=least(10,greatest(2,coalesce(p.total_pages*0.15,10))),null
   from reading_progress p join users u on coast_feature_enabled(u.id,'personalisation') and u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId})
  union all select r.user_id,r.media_id,r.updated_at,0,false,0,r.value,false,false,null,null,false,false,
    case when r.source='coast' then r.updated_at end from ratings r join users u on coast_feature_enabled(u.id,'personalisation') and u.id=r.user_id and not u.disabled where (${userId}::uuid is null or r.user_id=${userId})
  union all select p.user_id,p.game_id,p.updated_at,
   case when p.status='dropped' then -2 when p.status='completed' then 3 when p.status in ('in-progress','paused') then 2 else 1 end,
   p.status='completed',0,null,p.status='completed' or p.progress_percent>0,p.status='completed' and p.repeat,null,
   case when p.status='completed' then true when p.status='dropped' and p.progress_percent>0 then false end,false,p.status='completed' or p.progress_percent>=10,null
   from (select distinct on(user_id,game_id) * from game_playthroughs where (${userId}::uuid is null or user_id=${userId}) order by user_id,game_id,created_at desc,id desc) p
   join users u on coast_feature_enabled(u.id,'personalisation') and u.id=p.user_id and not u.disabled
  union all select c.user_id,g.game_id,max(coalesce(g.last_played_at,g.observed_at)),
   case when max(g.minutes_played)>=60 then 3 else 2 end,false,0,null,true,false,max(g.minutes_played),null,false,max(g.minutes_played)>=30,max(g.last_played_at)
  from game_account_state g join provider_connections c on c.sync_account_id=g.account_id and c.status='connected'
  join provider_instances i on i.id=c.instance_id and i.provider='steam' and i.enabled
  join users u on u.id=c.user_id and not u.disabled and coast_feature_enabled(u.id,'personalisation')
  where ${category??'all'} in ('all','game') and (${userId}::uuid is null or c.user_id=${userId}) and g.minutes_played>0
  group by c.user_id,g.game_id
  union all select p.user_id,p.track_id,p.updated_at,case when p.play_count>=3 then 4 when p.play_count>0 then 3 else 1 end,p.play_count>0,0,null,p.play_count>0,p.play_count>1,null,null,false,p.play_count>0,null
   from music_progress p join users u on coast_feature_enabled(u.id,'personalisation') and u.id=p.user_id and not u.disabled where (${userId}::uuid is null or p.user_id=${userId}) and (p.play_count>0 or p.position_seconds>0)
  union all select l.user_id,l.track_id,max(l.occurred_at),case when count(*)>=3 then 4 else 3 end,true,0,null,true,count(*)>1,null,null,
   ${tasteCategories?sql`count(distinct (l.occurred_at at time zone 'UTC')::date) filter(where l.occurred_at_known)>=5
    and max(l.occurred_at) filter(where l.occurred_at_known)-min(l.occurred_at) filter(where l.occurred_at_known)>=interval '14 days'`:sql`false`},true,max(l.occurred_at) filter(where l.occurred_at_known)
   from music_listens l join users u on coast_feature_enabled(u.id,'personalisation') and u.id=l.user_id and not u.disabled where (${userId}::uuid is null or l.user_id=${userId}) group by l.user_id,l.track_id
  union all select r.user_id,r.target_id,r.updated_at,0,false,case when r.emoji in ('❤️','🔥') then 4 else 0 end,null,false,false,null,null,false,false,null
   from social_reactions r join users u on coast_feature_enabled(u.id,'personalisation') and u.id=r.user_id and not u.disabled where coast_feature_enabled(r.user_id,'social') and r.target_kind='work' and (${userId}::uuid is null or r.user_id=${userId})
  ${screenHistory?sql`
   union all select ${userId}::uuid,h.media_id,h.updated,case when h.plays>1 then 4 else 3 end,true,0,null,true,h.plays>1,null,null,false,true,h.last_watch
   from screen_watches h
  `:sql``}
  ${tasteCategories?sql`
   union all select h.user_id,h.work_id,max(h.occurred_at),max(case when h.state='completed' then 3 else 2 end),bool_or(h.state='completed'),0,null,
    true,count(*) filter(where h.state='completed')>1,null,
    case when bool_or(h.state='completed') then true when bool_or(h.state='dropped' and h.page>0) then false end,
    count(distinct (h.occurred_at at time zone 'UTC')::date) filter(where h.state='completed')>=3,
    bool_or(h.state='completed' or h.page>=least(10,greatest(2,coalesce(h.total_pages*0.15,10)))),max(h.occurred_at)
   from reading_history h where h.user_id=${userId} and (h.state='completed' or h.page>0) group by h.user_id,h.work_id
   union all select p.user_id,p.game_id,max(p.completed_at),3,true,0,null,true,bool_or(p.repeat) or count(*)>1,null,true,
    count(distinct (p.completed_at at time zone 'UTC')::date)>=3,true,max(p.completed_at)
   from game_playthroughs p where p.user_id=${userId} and p.status='completed' group by p.user_id,p.game_id
   union all select p.user_id,p.game_id,max(s.played_at),2,false,0,null,true,false,sum(s.minutes_played),
    case when bool_or(p.status='dropped') then false end,false,sum(s.minutes_played)>=30,max(s.played_at)
   from game_playthroughs p join game_sessions s on s.playthrough_id=p.id where p.user_id=${userId} group by p.user_id,p.game_id
  `:sql``}
 )${musicHistory?sql`, recorded_albums as (
  select distinct on(rel.child_id) rel.child_id,rel.parent_id
  from (select distinct p.id from signals p join works track on track.id=p.id and track.kind='track') recorded
  join media_relationships rel on rel.child_id=recorded.id and rel.kind='contains'
  join works album on album.id=rel.parent_id and album.kind='album'
  order by rel.child_id,rel.position,rel.parent_id
 )`:sql``}, roots as (
  select ${root.id} as id,p.updated,p.id as source_id,p.implicit,p.explicit,p.rating,p.consumed,p.experienced,p.repeated,p.minutes,p.completed,p.deliberate_return,p.chosen,p.known_at,admitted.kind as source_kind,
   case when p.implicit<0 then -6 when p.rating is null then greatest(p.explicit,p.implicit)
    when p.rating<2.5 then -5 when p.rating>=3.5 then 5 else 0 end::float as weight,
   p.explicit>0 or coalesce(p.rating>=3.5,false) as positive
  from signals p join works admitted on admitted.id=p.id and ${tasteCategories?sql`admitted.category in (select category from unnest(${sql.array(tasteCategories,'TEXT')}::text[]) as permitted(category) where coast_category_enabled(${userId},category))`:sql`
    (${category??'all'}='all' or admitted.category=${category??'all'} or ${category??'all'}='reading' and admitted.kind in ('book','comic'))
    and coast_category_enabled(p.user_id,admitted.category)`}
  left join episodes e on e.media_id=p.id left join seasons s on s.media_id=p.id
  ${root.albumJoin}
 ${tasteCategories?sql`
 ), estimates as (
  -- A direct title rating wins over its children. A dropped episode alone cannot undo seeing the rest of the show.
  select id,coalesce(max(rating) filter(where source_id=id),
    percentile_cont(0.5) within group(order by rating) filter(where rating is not null)) as rating,
   bool_or(rating is not null and source_id=id) as direct_rating,
   count(*) filter(where rating is not null and source_kind='episode') as rated_episodes,
   count(*) filter(where rating is not null and source_kind='season') as rated_seasons,
   count(*) filter(where rating is not null and source_kind='track') as rated_tracks,
   jsonb_agg(jsonb_build_object('id',source_id,'rating',rating) order by source_id)
    filter(where source_id<>id and rating is not null) as child_ratings,
   bool_or(chosen) as chosen, bool_or(chosen and source_id=id) as root_chosen,
   count(distinct source_id) filter(where chosen and source_id<>id) as chosen_children,
   max(known_at) filter(where rating is null and known_at<=now()) as experienced_at,
   -- An imported rating records its arrival, and a child median has no single opinion date.
   max(known_at) filter(where source_id=id and rating is not null and known_at<=now()) as rated_at,
   max(explicit) as explicit,coalesce(min(implicit) filter(where source_id=id and implicit<0),
    max(implicit) filter(where implicit>0),min(implicit)) as implicit,
   bool_or(source_id=id and implicit<0) as dropped,
   bool_or(deliberate_return and source_id=id) or count(distinct source_id) filter(where deliberate_return)>=2 as deliberate_return,
   bool_or(experienced) as consumed,bool_or(repeated) as repeated,bool_or(repeated and source_id=id) as root_repeated,
   max(minutes) as minutes,bool_or(completed) as completed
  from roots group by id
 ), works_with_evidence as (
  select p.*,w.kind,case when w.category='music' then 'music' else w.kind end as medium
  from estimates p join works w on w.id=p.id
  where w.kind in ('movie','show','game','album','track','book','comic','artist')
 ), album_census as (
  select r.parent_id,count(*) as tracks from works_with_evidence w
  join media_relationships r on r.parent_id=w.id and r.kind='contains'
  join works track on track.id=r.child_id and track.kind='track'
  where w.kind='album' and ((not w.direct_rating and w.rated_tracks>0) or (w.chosen_children=1 and exists(
   select 1 from music_works album where album.id=w.id and album.membership_complete))) group by r.parent_id
 ), baselines as (
  select medium,count(*)::int as rating_count,percentile_cont(0.5) within group(order by rating) as median_rating
  from works_with_evidence where rating is not null group by medium
 ), ranked_games as (
  -- Ties split the middle rank. Four neutral observations shrink short histories.
  select id,(2*(rank() over(order by minutes)-1)+count(*) over(partition by minutes)-count(*) over())::float8
   /(count(*) over()+4) as rank from works_with_evidence where medium='game' and minutes>0
 ) select w.id,w.medium,w.kind,w.rating,w.explicit,
    case when w.kind='show' and w.implicit=4 and not (${repeated}) then 3 else w.implicit end as implicit,
    w.dropped,w.consumed,${repeated} as repeated,
    case when w.kind='album' then w.root_chosen or w.chosen_children>=2
     or w.chosen_children=1 and album_census.tracks=1 and exists(
      select 1 from music_works album where album.id=w.id and album.membership_complete)
     else w.chosen end as chosen,
    w.child_ratings as "childRatings", w.experienced_at as "lastExperiencedAt",w.rated_at as "lastRatedAt",
    case when w.child_ratings is null or w.direct_rating then 1 else least(1,sqrt(greatest(
     w.rated_episodes::float8/greatest(4,census.episodes),
     w.rated_seasons::float8/greatest(2,census.seasons),w.rated_tracks::float8/greatest(4,album_census.tracks)))) end as "ratingReliability",
    coalesce(b.rating_count,0) as "ratingCount",b.median_rating as "medianRating",g.rank as "playtimeRank"
   ${screenHistory?sql`,w.deliberate_return or coalesce(returns.deliberate,false) as "deliberateReturn",nullif(jsonb_strip_nulls(jsonb_build_object(
    'pace',pace.pace,'binge',binge.binge,'behind',backlog.behind)),'{}'::jsonb) as "watchHabits",case
    when t.paused then null
    when w.medium='movie' and t.watched then true
    when t.dropped and (w.consumed or t.position_seconds>0 or t.completed_episodes>0) then false
    -- Compare long-idle starts only on ended shows with a known, complete episode census.
    when lower(series.status) in ('ended','canceled','cancelled') and series.episodes>0
      and t.total_episodes>=series.episodes and t.completed_episodes>0
     then case when t.completed_episodes>=series.episodes then true
      when t.last_watched_at<now()-interval '90 days' then false end
    else w.completed end as completion`:sql`,w.deliberate_return as "deliberateReturn",null::jsonb as "watchHabits",w.completed as completion`}
   from works_with_evidence w left join baselines b using(medium) left join ranked_games g using(id)
   left join lateral (select
    case when not w.direct_rating and w.rated_episodes>0 then (select count(*) from episodes where show_id=w.id and not is_special) end as episodes,
    case when not w.direct_rating and w.rated_seasons>0 then (select count(*) from seasons where show_id=w.id and season_number>0) end as seasons
   ) census on true
   left join album_census on album_census.parent_id=w.id
   ${screenHistory?sql`
   left join watch_pace pace on pace.root=w.id
   left join binge_habits binge on binge.show_id=w.id
   left join watch_backlogs backlog on backlog.root=w.id
   left join screen_returns returns on returns.root=w.id
   left join tracking_state t on w.medium in ('movie','show') and t.user_id=${userId} and t.media_id=w.id
   left join lateral (
    select m.raw#>>'{facts,status}' as status,(m.raw#>>'{facts,episodeCount}')::int as episodes
    from metadata_snapshots m where w.medium='show' and t.completed_episodes>0 and not t.dropped
      and m.media_id=w.id and m.provider='tmdb'
      and jsonb_typeof(m.raw#>'{facts,episodeCount}')='number'
    order by m.updated_at desc,m.id limit 1
   ) series on true`:sql``}
   where exists(select 1 from users u where u.id=${userId} and not u.disabled and coast_feature_enabled(u.id,'personalisation'))
 `:sql`
 ), grouped as (
  ${groupedInterestRoots(userId)}
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
export async function visitTasteHistory(userId:string,categories:string[],visit:(works:TasteHistoryWork[])=>Promise<void>,metadataSource?:MetadataSource,independentHabits=false){
 if(!categories.length)return;
 await getSql().begin('read only',async tx=>{
  await tx`declare coast_taste_history no scroll cursor for ${interestQuery(userId,undefined,categories,metadataSource,independentHabits)}`;
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
