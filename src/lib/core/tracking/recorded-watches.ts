import { sql } from 'drizzle-orm';
import { historyScope } from './history-scope';
/** Ignore no-op watch observations while retaining explicit rewatches and watches after unwatch. */
export function recordedWatches(userId: string, mediaId?: string) {
  return sql`select *, (rewatch or prior_watches > 0) as rewatched from (
    select e.id as event_id, e.media_id, e.action, e.source, e.rewatch, e.occurred_at, e.occurred_at_known, e.edition_id, m.kind,
      lag(e.action) over (partition by e.media_id order by e.occurred_at, e.created_at, e.id) as prior,
      count(*) filter(where e.action = 'watch') over (partition by e.media_id order by e.occurred_at, e.created_at, e.id rows between unbounded preceding and 1 preceding) as prior_watches
    from tracking_events e join media m on m.id = e.media_id
    where e.user_id = ${userId} and e.applied and e.action in ('watch','unwatch') and m.kind in ('movie','episode') and ${mediaId ? sql`e.media_id in (${historyScope(mediaId)})` : sql`true`}
  ) events where action = 'watch' and (rewatch or prior is distinct from 'watch')`;
}
