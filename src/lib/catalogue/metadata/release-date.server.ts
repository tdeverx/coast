import { sql, type SQL } from 'drizzle-orm';
import type { CoastConfig } from '$lib/server/config';

/** The same non-personal field precedence as resolveMetadata, usable before paging. */
export function effectiveReleaseDate(id: SQL, policy: CoastConfig['metadataSource']) {
  return sql<string | null>`coalesce(
    (select o.release_date from metadata_overrides o where o.media_id=${id}),
    (select snapshot.release_date from metadata_snapshots snapshot
      where snapshot.media_id=${id} and snapshot.release_date is not null
        and (${policy}<>'tmdb-only' or snapshot.provider='tmdb')
      order by case snapshot.provider when 'jellyfin' then 0 when 'tmdb' then 1 else 2 end,
        snapshot.updated_at desc, snapshot.id limit 1),
    (select fallback.release_date from media fallback where fallback.id=${id}))`.mapWith(
      value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
    );
}
