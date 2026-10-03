import type { SQL } from 'bun';
import { getSql } from '$lib/server/db';

/** Time can change availability without a write. Each source contributes one
 * checkpoint boolean and one indexed expired predecessor, never a row count. */
export function collectionFreshnessSql(userId: string, database: SQL = getSql()) {
  return database`(select coalesce(md5(string_agg(c.id::text||':'||
    (c.status='connected' and c.enabled and c.completed_at is not null and c.scan_id is null and c.completed_at>=c.cutoff)::text||':'||
    coalesce(expired.verified_at::text,'none'),',' order by c.id)),'none') from (
      select c.id,c.status,i.enabled,cp.completed_at,cp.scan_id,
        now()-(case when i.provider='steam' then coalesce((i.settings->'schedule'->>'intervalMinutes')::integer,60)
          else coalesce((i.settings->'schedule'->>'userIntervalMinutes')::integer,10) end)*interval '2 minutes' as cutoff
      from provider_connections c join provider_instances i on i.id=c.instance_id
      left join sync_checkpoints cp on cp.connection_id=c.id and cp.kind=case when i.provider='steam' then 'steam-user' else 'jellyfin-user' end
      where c.user_id=${userId} and i.provider in ('jellyfin','steam') and not coalesce(c.settings->>'collectionSourceExcluded'='true',false)
    ) c left join lateral (
      select a.verified_at from availability a where a.user_id=${userId} and a.connection_id=c.id
        and (a.state='available' or (a.state='unavailable' and a.source->>'authoritative'='true'))
        and a.verified_at<c.cutoff order by a.verified_at desc limit 1
    ) expired on true)`;
}
