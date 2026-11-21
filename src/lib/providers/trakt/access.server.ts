import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.js';
import { outboxActions, providerConnections, socialLiveState } from '#lib/server/db/schema.js';
import { traktJobFeatures, traktJobKinds, traktPreferences, trackingFeatures, type TraktDirection, type TraktFeature } from './access';

/** Match the same complete, explicitly writable grant as traktAccess before admitting native changes. */
export const traktFeatureAllowed = (direction: TraktDirection, feature?: TraktFeature) =>
  sql<boolean>`coast_trakt_sync_allowed(${providerConnections.settings},${direction},${feature ?? null})`;

/** A missing grant retains import for existing accounts. Any malformed explicit grant fails closed. */
export const traktImportAllowed = traktFeatureAllowed('import');
export const traktExportAllowed = traktFeatureAllowed('export');

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Withdraw old work with the preference change, so re-enabling cannot replay it. */
export async function cancelDisabledTraktJobs(tx: Tx, connection: typeof providerConnections.$inferSelect, previous?: Record<string, unknown>) {
  const sync = traktPreferences(connection.settings);
  const before = previous && traktPreferences(previous);
  if (!sync.import.live) {
    await tx.update(socialLiveState).set({ workId: null, remoteId: null, expiresAt: null })
      .where(and(eq(socialLiveState.connectionId, connection.id), eq(socialLiveState.accountGeneration, connection.accountGeneration),
        isNotNull(socialLiveState.workId)));
  }
  const selected = (direction: TraktDirection, feature: TraktFeature) => {
    const selected: Partial<Record<TraktFeature, boolean>> = sync[direction];
    return selected[feature] === true;
  };
  const changed = (direction: TraktDirection, feature: TraktFeature) => {
    const old: Partial<Record<TraktFeature, boolean>> | undefined = before?.[direction];
    return !!old && (old[feature] === true) !== selected(direction, feature);
  };
  const kinds = (['import','export'] as const).flatMap(direction => traktJobKinds[direction].filter(kind => {
    if (kind === 'trakt.export') return false;
    if (kind === 'trakt.live' && before && before.import.history !== sync.import.history) return true;
    const features = traktJobFeatures(kind);
    // A combined import can keep running with any selected category, unless
    // the selection changed midway through that snapshot.
    return !features.some(feature => selected(direction, feature)) || features.some(feature => changed(direction, feature));
  }));
  const categories = trackingFeatures.filter(feature => !selected('export', feature) || changed('export', feature));
  if (!kinds.length && !categories.length) return;
  await tx.update(outboxActions).set({
    state: 'cancelled', lastError: 'Cancelled after Trakt connection permissions changed.', updatedAt: new Date(), lockedAt: null,
  }).where(and(eq(outboxActions.connectionId, connection.id), eq(outboxActions.accountGeneration, connection.accountGeneration),
    or(kinds.length ? inArray(outboxActions.kind, kinds) : undefined,
      categories.length ? and(eq(outboxActions.kind, 'trakt.export'), inArray(sql<string>`${outboxActions.payload}->>'category'`, categories)) : undefined),
    inArray(outboxActions.state, ['pending', 'running', 'failed'])));
}
