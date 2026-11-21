import * as v from 'valibot';
import { defaultSyncPreferences, type SyncCategory } from '../contracts';

export const traktAccessSchema = v.object({ import: v.boolean(), export: v.boolean() });
export type TraktAccess = v.InferOutput<typeof traktAccessSchema>;
export type TraktDirection = keyof TraktAccess;
export const defaultTraktAccess: TraktAccess = { import: true, export: false };

/** Older links can keep importing. Sending account changes requires explicit consent. */
export function traktAccess(settings: TraktSettings): TraktAccess {
  if (settings.traktSync !== undefined) {
    const sync = traktPreferences(settings);
    return { import: Object.values(sync.import).some(Boolean), export: Object.values(sync.export).some(Boolean) };
  }
  if (settings.traktAccess === undefined) return defaultTraktAccess;
  const result = v.safeParse(traktAccessSchema, settings.traktAccess);
  return result.success ? result.output : { import: false, export: false };
}

export const trackingFeatures = ['history', 'progress', 'collection', 'ratings', 'watchlist'] as const;
const categories = [...trackingFeatures, 'lists'] as const;
const trackingFields = {
  history: v.boolean(), progress: v.boolean(), collection: v.boolean(),
  ratings: v.boolean(), watchlist: v.boolean(), lists: v.boolean(),
};
export const traktSyncSchema = v.object({
  import: v.object({ ...trackingFields, live: v.boolean(), recommendations: v.boolean() }),
  export: v.object({ ...trackingFields, scrobble: v.boolean() }),
});
export type TraktSync = v.InferOutput<typeof traktSyncSchema>;
export type TraktFeature = keyof TraktSync['import'] | keyof TraktSync['export'];
type TraktSettings = { traktSync?: unknown; traktAccess?: unknown; sync?: unknown; liveRead?: unknown; collectionProjection?: unknown };

export function initialTraktSync(): TraktSync {
  return {
    import: { history: true, progress: true, collection: false, ratings: true, watchlist: true, lists: true, live: true, recommendations: true },
    export: { ...defaultSyncPreferences },
  };
}

export function traktPreferences(settings: TraktSettings): TraktSync {
  if (settings.traktSync !== undefined) {
    const stored = settings.traktSync as { import?: Partial<TraktSync['import']>; export?: Partial<TraktSync['export']> } | null;
    const result: TraktSync = {
      import: { ...defaultSyncPreferences, live: stored?.import?.live === true, recommendations: stored?.import?.recommendations === true },
      export: { ...defaultSyncPreferences, scrobble: stored?.export?.scrobble === true },
    };
    for (const category of categories) {
      result.import[category] = stored?.import?.[category] === true;
      result.export[category] = stored?.export?.[category] === true;
    }
    return result;
  }
  const legacy = traktAccess(settings);
  const sync = settings.sync as Partial<Record<SyncCategory, unknown>> | undefined;
  const projection = settings.collectionProjection as { enabled?: unknown } | undefined;
  const result: TraktSync = {
    import: { ...defaultSyncPreferences, live: legacy.import && settings.liveRead !== false, recommendations: legacy.import },
    export: { ...defaultSyncPreferences, scrobble: legacy.export && sync?.scrobble === true },
  };
  for (const category of categories) {
    result.import[category] = legacy.import && sync?.[category] === true;
    result.export[category] = legacy.export && sync?.[category] === true;
  }
  if (legacy.export && projection?.enabled === true) result.export.collection = true;
  return result;
}

/** Legacy consumers had an account-wide grant. Granular grants are authoritative once saved. */
export function traktAllows(settings: TraktSettings, direction: TraktDirection, feature?: TraktFeature) {
  if (!feature || settings.traktSync === undefined) return traktAccess(settings)[direction];
  const scope: Partial<Record<TraktFeature, boolean>> = traktPreferences(settings)[direction];
  return scope[feature] === true;
}

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

export function traktJobFeatures(kind: string, payload: Record<string, unknown> = {}): readonly TraktFeature[] {
  switch (kind) {
    case 'trakt.import': return trackingFeatures;
    case 'catalogue.user-scan': return categories;
    case 'trakt.lists-import': case 'trakt.list-export': case 'trakt.list-delete': return ['lists'];
    case 'trakt.live': return ['live'];
    case 'trakt.recommendations': return ['recommendations'];
    case 'trakt.progress': return ['progress'];
    case 'trakt.scrobble': case 'trakt.checkin': return ['scrobble'];
    case 'trakt.collection-project': case 'trakt.collection-cleanup': case 'trakt.collection-review': return ['collection'];
    case 'history.remove': return ['history'];
    case 'trakt.export': return categories.includes(payload.category as typeof categories[number]) ? [payload.category as typeof categories[number]] : [];
    default: return [];
  }
}

export function traktJobAllowed(settings: TraktSettings, kind: string, payload?: Record<string, unknown>) {
  const direction = traktJobDirection(kind);
  if (!direction) return true;
  if (settings.traktSync === undefined) return traktAccess(settings)[direction];
  const selected: Partial<Record<TraktFeature, boolean>> = traktPreferences(settings)[direction];
  return traktJobFeatures(kind, payload).some(feature => selected[feature] === true);
}
