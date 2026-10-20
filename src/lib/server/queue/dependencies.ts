/** Observations reconcile against current local intent at their domain owner.
 * They may pass unsent mutations, but never another running account worker. */
export const observationKinds = [
  'jellyfin.library', 'jellyfin.sync', 'jellyfin.bootstrap', 'jellyfin.delta',
  'catalogue.user-scan', 'trakt.import', 'trakt.lists-import', 'seerr.sync',
  'steam.sync', 'steam.achievements', 'igdb.steam-metadata',
  'tmdb.refresh', 'tmdb.recommendations', 'igdb.recommendations', 'trakt.recommendations',
];
const kinds = (values: string[]) => `(${values.map(value => `'${value}'`).join(',')})`;
/** Unknown/bulk effects keep the conservative whole-account barrier. Different
 * fields of one work deliberately share a key (watch/reset/history/progress). */
export function dependencyScopeSql(action: string) {
  return `case
    when ${action}.kind in ${kinds(observationKinds)} then null
    when ${action}.kind in ('jellyfin.user-state','jellyfin.reconcile','trakt.export','trakt.progress','history.remove','trakt.scrobble')
      then coalesce('work:'||(${action}.payload->>'mediaId'),'*')
    when ${action}.kind='jellyfin.scrobble' then coalesce('work:'||(select p.media_id::text from playback_sessions p
      where p.id=case when ${action}.payload->>'sessionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (${action}.payload->>'sessionId')::uuid end
        and p.user_id=${action}.user_id and p.connection_id=${action}.connection_id),'*')
    when ${action}.kind in ('trakt.list-export','trakt.list-delete') then coalesce('list:'||(${action}.payload->>'listId'),'*')
    when ${action}.kind in ('seerr.request','seerr.manage') then coalesce('request:'||(${action}.payload->>'requestId'),'*')
    when ${action}.kind='trakt.checkin' then coalesce('checkin:'||(${action}.payload->>'checkinId'),'*')
    else '*' end`;
}

/** Compute lane/effect heads once per statement. The old correlated predicate
 * built the same account bitmap thousands of times under the claim lock.
 * Guard absent head IDs before comparing tuples: an earlier timestamp alone
 * can make a row comparison true even when the head ID is NULL. */
export function queueOrderCteSql(independent:string[],automatic:string[]) {
  return `with queue_scopes as materialized (
    select a.id,a.user_id,a.connection_id,a.created_at,a.state,${dependencyScopeSql('a')} as effect_scope
    from outbox_actions a left join provider_connections c on c.id=a.connection_id
    where a.state in ('pending','running','failed') and a.kind not in ${kinds(independent)} and a.kind not like '%.live'
      and (c.id is null or a.account_generation is null or a.account_generation=c.account_generation)
      and (a.state='running' or coalesce((select value->>'developerMode' from system_settings where key='coast'),'false')<>'true'
        or a.kind not in ${kinds(automatic)} or a.payload->>'_manual'='true')
  ), queue_heads as materialized (
    select *,
      first_value(case when state='running' then id end) over running_lane as running_id,
      first_value(case when state<>'running' and effect_scope is not null then id end) over mutation_lane as lane_id,
      first_value(created_at) over mutation_lane as lane_at,
      first_value(case when state<>'running' and effect_scope='*' then id end) over wildcard_lane as wildcard_id,
      first_value(created_at) over wildcard_lane as wildcard_at,
      first_value(id) over effect_lane as effect_id,
      first_value(created_at) over effect_lane as effect_at
    from queue_scopes
    window
      running_lane as (partition by user_id,connection_id order by (state='running') desc,created_at,id),
      mutation_lane as (partition by user_id,connection_id order by (state<>'running' and effect_scope is not null) desc,created_at,id),
      wildcard_lane as (partition by user_id,connection_id order by (state<>'running' and effect_scope is not distinct from '*') desc,created_at,id),
      effect_lane as (partition by user_id,connection_id,effect_scope order by (state='running'),created_at,id)
  ), queue_blockers as materialized (
    select id,case
      when running_id is not null and running_id<>id then running_id
      when effect_scope is null then null
      when effect_scope='*' and lane_id is not null and (lane_at,lane_id)<(created_at,id) then lane_id
      when wildcard_id is not null and (wildcard_at,wildcard_id)<(created_at,id) then wildcard_id
      when (effect_at,effect_id)<(created_at,id) then effect_id
      else null end as blocking_id
    from queue_heads
  )`;
}
