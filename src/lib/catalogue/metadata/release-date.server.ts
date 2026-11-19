import { sql, type SQL } from 'drizzle-orm';
import type { CoastConfig } from '#lib/server/config.js';

const overrideDate = (id: SQL) => sql`(select o.release_date from metadata_overrides o where o.media_id=${id})`;
const storedDate = (id: SQL) => sql`(select fallback.release_date from media fallback where fallback.id=${id})`;
const datePreference = sql`case snapshot.provider when 'jellyfin' then 0 when 'tmdb' then 1 else 2 end,
  snapshot.updated_at desc, snapshot.id`;

/** The same non-personal field precedence as resolveMetadata, usable before paging. */
export function effectiveReleaseDate(id: SQL, policy: CoastConfig['metadataSource']) {
  return sql<string | null>`coalesce(
    ${overrideDate(id)},
    (select snapshot.release_date from metadata_snapshots snapshot
      where snapshot.media_id=${id} and snapshot.release_date is not null
        and (${policy}<>'tmdb-only' or snapshot.provider='tmdb')
      order by ${datePreference} limit 1),
    ${storedDate(id)})`.mapWith(
      value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
    );
}

/** An unknown date is not evidence that an episode has aired. */
export function episodeHasAired(id: SQL, policy: CoastConfig['metadataSource'], { includeToday = true } = {}) {
  // Episode dates have no broadcast time. Progress can require a full elapsed day.
  const comparison = includeToday ? sql`<=` : sql`<`;
  return sql<boolean>`coalesce(${effectiveReleaseDate(id, policy)} ${comparison} (now() at time zone 'UTC')::date, false)`;
}

/** Prefer the episode timestamp, then the series' zoned schedule. */
export function episodeHasAiredForProgress(id: SQL, policy: CoastConfig['metadataSource']) {
  if(policy==='tmdb-only')return episodeHasAired(id,policy,{includeToday:false});
  const today=sql`(now() at time zone 'UTC')::date`;
  const series=sql`(select (resolved.air_date+(timing.raw->'airSchedule'->>'time')::time)
    at time zone (timing.raw->'airSchedule'->>'timeZone')
    from episodes e join metadata_snapshots timing on timing.media_id=e.show_id
    where e.media_id=${id} and resolved.air_date is not null and not e.is_special
      and (timing.raw->'airSchedule'->>'timeZone') in (select name from pg_timezone_names)
      and coalesce((timing.raw->'airSchedule'->>'weekday')::int,extract(dow from resolved.air_date))=extract(dow from resolved.air_date)
    order by timing.updated_at desc,timing.id limit 1)`;
  // Read episode dates and timestamps in one indexed snapshot lookup. A series
  // schedule only needs checking around the air date, including across UTC midnight.
  return sql<boolean>`(select case
    when resolved.first_aired is not null and resolved.override_date is null then resolved.first_aired::timestamptz<=now()
    when resolved.air_date < ${today}-1 then true
    when resolved.air_date > ${today}+1 then false
    else coalesce(${series}<=now(),resolved.air_date<${today},false)
    end from (select manual.override_date,
      coalesce(manual.override_date,snapshot_timing.air_date,${storedDate(id)}) as air_date,snapshot_timing.first_aired
      from (select ${overrideDate(id)} as override_date offset 0) manual
      cross join (select
        (array_agg(snapshot.release_date order by ${datePreference}) filter(where snapshot.release_date is not null))[1] as air_date,
        (array_agg(snapshot.raw->>'firstAiredAt' order by snapshot.updated_at desc,snapshot.id)
          filter(where snapshot.raw->>'firstAiredAt' is not null))[1] as first_aired
        from metadata_snapshots snapshot where snapshot.media_id=${id}) snapshot_timing
    ) resolved)`;
}
