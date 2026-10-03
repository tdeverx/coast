import { getSql } from '$lib/server/db';
import { friendStatusSql } from '$lib/social/status.server';
import { collectionFreshnessSql } from '$lib/collection/freshness.server';

export type ContentRevision = { tracking: string; social: string; planning: string };

/** Durable counters cover provider/public API writes, deletion and reordering.
 * Reads scale with accepted friends and their active connections, never history
 * or the shared catalogue. Presence heartbeat timestamps are not content. */
export async function contentRevision(userId: string, viewedUsername: string|null=null): Promise<ContentRevision> {
  const [row] = await getSql()`with peers as (
    select ${userId}::uuid as id union select case when user_a=${userId} then user_b else user_a end
    from friendships where (user_a=${userId} or user_b=${userId}) and state='accepted'
  ), watched as (select u.id from users u where lower(u.username)=lower(${viewedUsername}) and not u.disabled
    and exists(select 1 from unnest(array['collection','activity','progress','favourites','ratings']) section
      where social_visible(u.id,${userId}::uuid,section))),
  own as (select domain,revision::text from content_revisions where scope=${userId}),
  shared as (select domain,revision::text from content_revisions where scope='global')
  select concat_ws(':',current_date::text,
    coalesce((select revision from own where domain='tracking'),'0'),
    coalesce((select revision from shared where domain='tracking'),'0'),
    coalesce((select r.revision::text from content_revisions r join watched w on r.scope=w.id::text where r.domain='tracking'),'0'),${collectionFreshnessSql(userId)}) as tracking,
    concat_ws(':',current_date::text,
      coalesce((select md5(string_agg(r.scope||':'||r.revision::text,',' order by r.scope)) from content_revisions r join peers p on r.scope=p.id::text where r.domain='social'),'0'),
      coalesce((select revision from shared where domain='social'),'0'),
      (select md5(string_agg(u.id::text||':'||${friendStatusSql(userId)},',' order by u.id)) from users u join peers p on p.id=u.id left join user_presence up on up.user_id=u.id where not u.disabled),
      (select count(*) from social_checkins s join peers p on p.id=s.user_id where s.state='active' and s.expires_at>now()),
      (select count(*) from social_live_state s join provider_connections c on c.id=s.connection_id join peers p on p.id=c.user_id where s.work_id is not null and s.expires_at>now())) as social,
    concat_ws(':',current_date::text,coalesce((select revision from own where domain='planning'),'0')) as planning`;
  return row as ContentRevision;
}
