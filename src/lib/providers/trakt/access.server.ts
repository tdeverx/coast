import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.js';
import { outboxActions, providerConnections, socialLiveState } from '#lib/server/db/schema.js';
import { traktAccess, traktJobKinds, type TraktAccess } from './access';

/** Match the same complete, explicitly writable grant as traktAccess before admitting native changes. */
export const traktExportAllowed = sql<boolean>`coalesce((${providerConnections.settings}->'traktAccess' @> '{"export":true}'::jsonb
  and jsonb_typeof(${providerConnections.settings}->'traktAccess'->'import')='boolean'),false)`;

/** A missing grant retains import for existing accounts. Any malformed explicit grant fails closed. */
export const traktImportAllowed = sql<boolean>`coalesce((not (${providerConnections.settings} ? 'traktAccess') or
  (${providerConnections.settings}->'traktAccess' @> '{"import":true}'::jsonb
    and jsonb_typeof(${providerConnections.settings}->'traktAccess'->'export')='boolean')),false)`;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Withdraw old work with the preference change, so re-enabling cannot replay it. */
export async function cancelDisabledTraktJobs(tx: Tx, connection: typeof providerConnections.$inferSelect, previous?: TraktAccess) {
  const access = traktAccess(connection.settings);
  if (!access.import || connection.settings.liveRead === false) {
    await tx.update(socialLiveState).set({ workId: null, remoteId: null, expiresAt: null })
      .where(and(eq(socialLiveState.connectionId, connection.id), eq(socialLiveState.accountGeneration, connection.accountGeneration),
        isNotNull(socialLiveState.workId)));
  }
  const kinds = [...(access.import && previous?.import !== false ? [] : traktJobKinds.import),
    ...(access.export && previous?.export !== false ? [] : traktJobKinds.export)];
  if (!kinds.length) return;
  await tx.update(outboxActions).set({
    state: 'cancelled', lastError: 'Cancelled after Trakt connection permissions changed.', updatedAt: new Date(), lockedAt: null,
  }).where(and(eq(outboxActions.connectionId, connection.id), eq(outboxActions.accountGeneration, connection.accountGeneration),
    inArray(outboxActions.kind, kinds), inArray(outboxActions.state, ['pending', 'running', 'failed'])));
}
