import { sql } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.js';

/** Jellyfin sends RFC 3339 timestamps and may use .NET's default date for missing values. */
export function jellyfinAddedDate(value: string | null | undefined): string | undefined {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() <= 1 || date.getUTCFullYear() > 9999) return;
  return date.toISOString();
}
/** Enrich an existing authenticated scan batch without rewriting unchanged provider items. */
export async function saveJellyfinAddedDates(db: Pick<Database, 'execute'>, dates: ReadonlyMap<string, string>) {
  if (!dates.size) return;
  await db.execute(sql`
    update provider_items item set snapshot=item.snapshot || jsonb_build_object('addedAt',dates.added_at)
    from (values ${sql.join([...dates].map(([id,date]) => sql`(${id}::uuid,${date}::text)`), sql`,`)}) dates(id,added_at)
    where item.id=dates.id and item.snapshot->>'addedAt' is distinct from dates.added_at`);
}
