import * as v from 'valibot';
import type { SyncPreferences } from '../contracts';

export const traktAccessSchema = v.object({ import: v.boolean(), export: v.boolean() });
export type TraktAccess = v.InferOutput<typeof traktAccessSchema>;
export type TraktDirection = keyof TraktAccess;
export const defaultTraktAccess: TraktAccess = { import: true, export: false };

/** Older links can keep importing. Sending account changes requires explicit consent. */
export function traktAccess(settings: { traktAccess?: unknown } | Record<string, unknown>): TraktAccess {
  if (settings.traktAccess === undefined) return defaultTraktAccess;
  const result = v.safeParse(traktAccessSchema, settings.traktAccess);
  return result.success ? result.output : { import: false, export: false };
}

export const initialTraktSyncPreferences: SyncPreferences = {
  history: true, progress: true, ratings: true, watchlist: true, lists: true,
  collection: false, scrobble: false,
};

/** Only classify jobs on a verified Trakt connection. Public catalogue jobs have no account. */
export const traktJobKinds: Record<TraktDirection, readonly string[]> = {
  import: ['trakt.import', 'trakt.lists-import', 'trakt.live', 'trakt.recommendations', 'catalogue.user-scan'],
  export: ['trakt.export', 'trakt.progress', 'trakt.scrobble', 'trakt.checkin', 'trakt.list-export',
    'trakt.list-delete', 'trakt.collection-project', 'trakt.collection-cleanup', 'trakt.collection-review', 'history.remove'],
};

export function traktJobDirection(kind: string): TraktDirection | undefined {
  if (traktJobKinds.import.includes(kind)) return 'import';
  if (traktJobKinds.export.includes(kind)) return 'export';
}
