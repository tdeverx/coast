import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userMetadataPreferences } from '$lib/server/db/schema';
import { PAGE_SIZE } from '$lib/server/queries/pagination';
import type { MediaCardPresentation } from '$lib/ui/types';
import { searchDocument, searchSql } from '$lib/server/queries/search-ranking';

/** Viewer-owned preferences; never borrow the displayed profile owner's private aliases. */
export async function presentationPreferences(viewerId: string | null, ids: string[]) {
  const result = new Map<string, typeof userMetadataPreferences.$inferSelect>();
  if (!viewerId) return result;
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += PAGE_SIZE) {
    const rows = await getDb().select().from(userMetadataPreferences).where(and(eq(userMetadataPreferences.userId, viewerId),
      inArray(userMetadataPreferences.mediaId, unique.slice(offset, offset + PAGE_SIZE))));
    for (const row of rows) result.set(row.mediaId, row);
  }
  return result;
}
export async function personaliseWorkCards<T extends MediaCardPresentation>(viewerId: string | null, items: T[]): Promise<T[]> {
  const preferences = await presentationPreferences(viewerId, items.flatMap(item => item.workId ? [item.workId] : []));
  return items.map(item => {
    const preference = item.workId ? preferences.get(item.workId) : undefined;
    return preference ? { ...item, title: preference.title ?? item.title, poster: preference.posterPath ?? item.poster,
      backdrop: preference.backdropPath ?? item.backdrop } : item;
  });
}
/** Match private aliases before counts/limits using the existing indexed document. */
export function presentationSearch(viewerId: string | null, id: SQL, query: string) {
  const alias = searchSql(query, [searchDocument(sql`mp.title`)], [sql`mp.title`]);
  return {
    matches: (fallback = false) => viewerId ? sql`${id} in (select mp.media_id from user_metadata_preferences mp where mp.user_id=${viewerId} and ${fallback ? alias.fallback : alias.matches})` : sql`false`,
    rank: viewerId ? sql<number>`coalesce((select ${alias.rank} from user_metadata_preferences mp where mp.user_id=${viewerId} and mp.media_id=${id}),0)` : sql<number>`0`,
  };
}
