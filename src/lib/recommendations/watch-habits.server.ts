import type { getSql } from '#lib/server/db/index.js';
import { sourceOrder, sourcePreference, type MetadataSource } from '#lib/catalogue/metadata/resolve.js';

/** Add compact per-title evidence to the existing full screen-history scan. */
export function watchHabitsCtes(sql: ReturnType<typeof getSql>, userId: string, policy: MetadataSource, independent = false) {
 const sources=sql.array([...sourceOrder(policy,'release')],'TEXT');
 const tmdbOnly=sourcePreference(policy,'release')==='tmdb-only';
 return sql`
  watched_episodes as materialized (
   select e.media_id,e.show_id,e.season_number,e.episode_number,h.first_watch,h.last_watch,h.known_plays,
    h.first_watch-lag(h.first_watch) over(partition by e.show_id order by h.first_watch,e.media_id) as gap
   from screen_watches h join episodes e on e.media_id=h.media_id
   where h.first_watch is not null and not e.is_special and e.season_number>0
  ),
  screen_returns as (
   select h.media_id as root,true as deliberate from screen_watches h join media m on m.id=h.media_id
   where m.kind='movie' and h.known_plays>=3
   union all select show_id,count(*) filter(where known_plays>=3)>=2 and count(*) filter(where known_plays>=3)*3>=count(*)
   from watched_episodes group by show_id
   -- Returning to one episode does not establish a preference for the whole series.
   having count(*) filter(where known_plays>=2)>=2 and count(*) filter(where known_plays>=2)*3>=count(*)
  ),
  watch_frontiers as (
   select distinct on (show_id) show_id,season_number,episode_number,
    max(last_watch) over(partition by show_id) as last_watch,count(*) over(partition by show_id) as episodes_seen
   from watched_episodes order by show_id,season_number desc,episode_number desc
  ),
  overdue_candidates as (
   select e.media_id,frontier.show_id,frontier.last_watch
   from watch_frontiers frontier join episodes e on e.show_id=frontier.show_id
     and (e.season_number,e.episode_number)>(frontier.season_number,frontier.episode_number)
   left join tracking_state parent on parent.user_id=${userId} and parent.media_id=frontier.show_id
   left join tracking_state child on child.user_id=${userId} and child.media_id=e.media_id
   left join screen_watches watched on watched.media_id=e.media_id
   where frontier.episodes_seen>=2 and frontier.last_watch<=now()-interval '7 days' and not e.is_special
    and not coalesce(parent.paused or parent.dropped,false) and watched.media_id is null
    and not coalesce(child.watched or child.dropped or child.paused or child.play_count>0 or child.position_seconds>0,false)
  ),
  habit_subjects as (
   select media_id,show_id as root,first_watch,null::timestamptz as watch_frontier from watched_episodes
   union all select h.media_id,h.media_id,h.first_watch,null::timestamptz from screen_watches h
    join media m on m.id=h.media_id and m.kind='movie' where h.first_watch is not null
   union all select media_id,show_id,null::timestamptz,last_watch from overdue_candidates
  ),
  habit_releases as materialized (
   select h.*,j.available_since,coalesce(o.release_date,metadata.air_date,m.release_date) as air_date,
    case when o.release_date is null and pg_input_is_valid(metadata.first_aired,'timestamptz')
      then metadata.first_aired::timestamptz end as aired_at
   from habit_subjects h join media m on m.id=h.media_id
   left join jellyfin_plays j on j.media_id=h.media_id
   left join metadata_overrides o on o.media_id=h.media_id
   left join lateral (
    select (array_agg(s.release_date order by array_position(${sources}::text[],s.provider),s.updated_at desc,s.id)
      filter(where s.release_date is not null))[1] as air_date,
     (array_agg(s.raw->>'firstAiredAt' order by array_position(${sources}::text[],s.provider),s.updated_at desc,s.id)
      filter(where s.raw->>'firstAiredAt' is not null))[1] as first_aired
    from metadata_snapshots s where s.media_id=h.media_id and (not ${tmdbOnly} or s.provider='tmdb')
   ) metadata on o.release_date is null
  ),
  opportunities as materialized (
   select *,case when aired_at is not null or air_date is not null then greatest(
    coalesce(aired_at,air_date::timestamp at time zone 'UTC'),
    case when first_watch is null or available_since<=first_watch then available_since end) end as opportunity
   from habit_releases
  ),
  watch_delays as (
   select root,first_watch-opportunity as delay,
    air_date-lag(air_date) over(partition by root order by air_date,media_id) as days_between_releases,
    case when aired_at is null
    and (available_since is null or available_since is distinct from opportunity) then 0.65 else 1 end as precision,
    root<>media_id as series
   from opportunities where first_watch>=opportunity
  ),
  usual_delay as (
   -- Give every series one observation. Multiple seasons of a single favourite cannot set a personal baseline.
   select least(interval '7 days',percentile_cont(0.5) within group(order by typical)) as typical
   from (select root,percentile_cont(0.5) within group(order by delay) as typical
    from watch_delays where series and delay<=interval '21 days' group by root having count(*)>=3) timelines
   having count(*)>=4 and ${!independent}
  ),
  weekly_following as (
   select root from watch_delays where series group by root having
    count(*) filter(where days_between_releases between 4 and 10 and delay<=interval '7 days')>=2
    and count(*) filter(where delay<=interval '7 days')>=0.8*count(*)
  ),
  watch_pace as (
   select root,avg(case when delay<=interval '24 hours' then precision
    when series and (usual.typical is not null and delay<=usual.typical+interval '1 day'
     or followed.root is not null and delay<=interval '7 days') then 0.75*precision
    when delay<interval '7 days' then 0.32*precision else 0 end)::float8 as pace
   from watch_delays left join weekly_following followed using(root) left join usual_delay usual on true group by root
  ),
  binge_runs as (
   select show_id,sum(case when gap between interval '2 minutes' and interval '3 hours' then 0 else 1 end)
    over(partition by show_id order by first_watch,media_id) as run from watched_episodes
  ),
  binge_rates as (
   select show_id,coalesce(sum(episodes) filter(where episodes>=3),0)::float8/sum(episodes)
     * count(*) filter(where episodes>=3)::float8/(count(*) filter(where episodes>=3)+1) as rate
   from (select show_id,run,count(*) as episodes from binge_runs group by show_id,run) sessions group by show_id
   having sum(episodes)>=3
  ),
  binge_habits as (
   select show_id,nullif(rate,0)*case when ${!independent} and count(*) over()>=5 then
    1-0.4*(sum(rate) over()-rate)/(count(*) over()-1) else 1 end as binge
   from binge_rates
  ),
  watch_backlogs as (
   select root,least(count(*),4)::float8/4 as behind
   from opportunities left join usual_delay usual on true where watch_frontier is not null
    and opportunity>watch_frontier
    and greatest(opportunity,coalesce(aired_at,(air_date+1)::timestamp at time zone 'UTC'))
      <=now()-interval '7 days'-coalesce(usual.typical,interval '0 days')
   group by root having count(*)>=2
  ),`;
}
