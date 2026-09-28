import { sql, type SQL } from 'drizzle-orm';
import { media } from '../db/schema';

/** Known, accepted viewing dates only; parent cards inherit episode activity. */
export function viewingRecency(userId: string, root: SQL = sql`${media.id}`) {
  const related = sql`select ${root}
    union select e.media_id from episodes e where e.show_id = ${root} or e.season_id = ${root}`;
  return sql`greatest(
    (select max(t.last_watched_at) from tracking_state t
      where t.user_id = ${userId} and t.media_id in (${related})),
    (select max(e.occurred_at) from tracking_events e
      where e.user_id = ${userId} and e.media_id in (${related})
        and e.applied and e.occurred_at_known
        and (e.action = 'watch' or (e.action = 'progress' and e.position_seconds > 0)))
  )`;
}
