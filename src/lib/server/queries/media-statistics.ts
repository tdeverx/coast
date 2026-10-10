import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { recordedWatches } from '$lib/core/tracking/recorded-watches.server';
import { periodStart, type ProfilePeriod } from '$lib/profile/period';
import type { MediaStatistics } from '$lib/media/statistics';
/** Same recorded-watch semantics as profile statistics, scoped to this title and its descendants. */
export async function mediaStatistics(
  userId: string,
  mediaId: string,
  period: ProfilePeriod,
  now = new Date()
): Promise<MediaStatistics> {
  const start = periodStart(period, now);
  const history = sql`select * from (${recordedWatches(userId, mediaId)}) h where occurred_at <= ${now.toISOString()}::timestamptz and ${start ? sql`occurred_at_known and occurred_at >= (${start}::date::timestamp at time zone 'UTC')` : sql`true`}`;
  const rows = await getDb().execute(sql`with history as (${history})
    select count(*)::int as watches, count(distinct media_id)::int as unique,
      count(*) filter(where not occurred_at_known)::int as undated,
      min(occurred_at) filter(where occurred_at_known) as first,
      max(occurred_at) filter(where occurred_at_known) as last,
      coalesce((select jsonb_agg(d order by d.date) from (
        select to_char(occurred_at at time zone 'UTC','YYYY-MM-DD') as date,
          count(*) filter(where kind='movie')::int as movies,
          count(*) filter(where kind='episode')::int as episodes
        from history where occurred_at_known group by 1
      ) d), '[]'::jsonb) as days from history`);
  const row = rows[0];
  const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
  return {
    today: now.toISOString().slice(0, 10),
    watches: Number(row.watches),
    unique: Number(row.unique),
    undated: Number(row.undated),
    first: iso(row.first),
    last: iso(row.last),
    days: row.days as MediaStatistics['days'],
  };
}
