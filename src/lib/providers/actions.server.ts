import { getConfig } from '$lib/server/config';
import { conflictPreference } from '$lib/sync/preference';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { mediaRequests, externalIds, syncValues } from '$lib/server/db/schema';
import {
  registerActionHandler,
  PermanentActionError,
  tagDiagnosticStage,
  type ActionHandler,
} from '$lib/server/queue';
import { ProviderActionError, type DiscoverKind } from '$lib/providers/contracts';
import { connectionFor } from '$lib/providers/connections.server';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import { getSeerr } from '$lib/providers/seerr/connection.server';
import { refreshRequests } from '$lib/providers/seerr/requests.server';
import { startProviderMaintenance } from '$lib/providers/maintenance.server';

const uuid = v.pipe(v.string(), v.uuid());

export function registerProviderActions(options: { maintenance?: boolean } = {}) {
  const register = (kind: string, handler: ActionHandler) =>
    registerActionHandler(kind, async (action) => {
      try {
        const config = await getConfig();
        if ((action.kind.startsWith('trakt.') && !config.enableTrakt) || (action.kind.startsWith('seerr.') && !config.enableRequests))
          throw new PermanentActionError('This service is disabled by the administrator.');
        return await handler(action);
      } catch (error) {
        if (error instanceof ProviderActionError) throw new PermanentActionError(error.message);
        throw error;
      }
    });
  if (options.maintenance !== false) startProviderMaintenance();
  register('catalogue.user-scan', async action => (await import('$lib/catalogue/maintenance.server')).scanUserCatalogue(action));
  register('tmdb.refresh', async action => {
    v.parse(v.object({ instanceId: uuid, force: v.optional(v.boolean(), false) }), action.payload);
    return (await import('$lib/catalogue/maintenance.server')).refreshSharedMetadata(action);
  });
  register('social.checkin-complete',async action=>{await (await import('$lib/social/presence.server')).completeCheckin(action.userId,v.parse(uuid,action.payload.checkinId));});
  register('trakt.live',async action=>{if(action.connectionId)await (await import('$lib/social/trakt.server')).pollLive(action.userId,action.connectionId);});
  register('trakt.checkin',async action=>{if(action.connectionId)await (await import('$lib/social/trakt.server')).deliverCheckin(action.userId,action.connectionId,v.parse(uuid,action.payload.checkinId));});
  register('seerr.manage', async (action) => {
    const data = v.parse(
      v.object({
        requestId: uuid,
        action: v.picklist(['cancel', 'approve', 'decline']),
        resolved: v.optional(v.boolean(), false),
        expectedState: v.optional(v.string()),
      }),
      action.payload
    );
    const [request] = await getDb()
      .select()
      .from(mediaRequests)
      .where(eq(mediaRequests.id, data.requestId));
    if (!request?.externalId) return;
    const { adapter, connection } = await getSeerr(action.userId, request.instanceId);
    const desired =
      data.action === 'cancel'
        ? 'cancelled'
        : data.action === 'approve'
          ? 'approved'
          : 'declined';
    if (!data.resolved) {
      let remoteState: typeof mediaRequests.$inferSelect.state;
      try {
        const remote = await adapter.requestDetails(Number(request.externalId));
        remoteState =
          (remote.is4k ? remote.media?.status4k : remote.media?.status) === 5
            ? 'available'
            : remote.status === 2
              ? 'approved'
              : remote.status === 3
                ? 'declined'
                : 'pending';
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        remoteState = 'cancelled';
      }
      if (remoteState !== (data.expectedState ?? request.state) && remoteState !== desired) {
        const preference = await getDb().transaction((tx) =>
          conflictPreference(tx, action.userId, connection.id)
        );
        if (preference === 'remote') {
          await getDb()
            .update(mediaRequests)
            .set({ state: remoteState, updatedAt: new Date() })
            .where(eq(mediaRequests.id, request.id));
          await getDb()
            .update(syncValues)
            .set({
              conflict: false,
              agreed: { value: remoteState },
              remote: { value: remoteState },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(syncValues.connectionId, connection.id),
                eq(syncValues.category, `request:${request.id}`)
              )
            );
          return;
        }
        if (preference === 'manual') {
          const values = {
            remote: { value: remoteState },
            agreed: { value: desired },
            conflict: true,
            updatedAt: new Date(),
          };
          await getDb()
            .insert(syncValues)
            .values({
              connectionId: connection.id,
              mediaId: request.mediaId,
              category: `request:${request.id}`,
              ...values,
            })
            .onConflictDoUpdate({
              target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
              set: values,
            });
          return;
        }
      }
    }
    await adapter.manage(Number(request.externalId), data.action);
    await getDb()
      .update(syncValues)
      .set({
        conflict: false,
        agreed: { value: desired },
        remote: { value: desired },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(syncValues.connectionId, connection.id),
          eq(syncValues.category, `request:${request.id}`)
        )
      );
    await getDb()
      .update(mediaRequests)
      .set({
        state:
          data.action === 'cancel'
            ? 'cancelled'
            : data.action === 'approve'
              ? 'approved'
              : 'declined',
        updatedAt: new Date(),
      })
      .where(eq(mediaRequests.id, request.id));
  });
  register('trakt.list-delete', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { adapter, sync } = await getTrakt(action.userId, action.connectionId);
    if (sync.lists) {
      let externalId =
        typeof action.payload.externalId === 'string' ? action.payload.externalId : undefined;
      if (!externalId && typeof action.payload.listId === 'string') {
        const reference = `Coast reference: ${action.payload.listId}`;
        externalId = (await adapter.lists())
          .find((list) => list.description?.split('\n').includes(reference))
          ?.ids.trakt.toString();
      }
      if (externalId) await adapter.deleteList(externalId);
    }
  });
  register('trakt.progress', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeProgressExport } = await import('$lib/sync/trakt-export');
    await executeProgressExport(action.userId, action.connectionId, action.payload);
  });
  register('seerr.sync', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Seerr connection is unavailable.');
    const { instance } = await connectionFor(action.userId, action.connectionId, 'seerr');
    await refreshRequests(action.userId, instance.id);
  });
  register('history.remove', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The connection is unavailable.');
    const { executeHistoryRemoval } = await import('$lib/sync/history-removal');
    await executeHistoryRemoval(action.userId, action.connectionId, action.payload);
  });
  register('trakt.collection-review',async action=>{
    if(!action.connectionId)throw new PermanentActionError('The connection is unavailable.');
    const {executeProjectionReview}=await import('$lib/collection/projection.server');await executeProjectionReview(action.userId,action.connectionId,action.payload);
  });
  for(const kind of ['trakt.collection-project','trakt.collection-cleanup'])register(kind,async action=>{
    if(!action.connectionId)throw new PermanentActionError('The connection is unavailable.');
    const {executeProjection}=await import('$lib/collection/projection.server');await executeProjection(action.userId,action.connectionId,kind.endsWith('cleanup')?action.payload:undefined);
  });
  register('jellyfin.reconcile',async action=>{
    if(!action.connectionId)throw new PermanentActionError('The connection is unavailable.');
    const {connection}=await connectionFor(action.userId,action.connectionId,'jellyfin');
    if(connection.settings.reconcileTracking!==true)return;
    const {executeJellyfinUserState}=await import('$lib/sync/jellyfin');await executeJellyfinUserState(action.userId,action.connectionId,action.payload);
  });
  register('jellyfin.user-state', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { executeJellyfinUserState } = await import('$lib/sync/jellyfin');
    await executeJellyfinUserState(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.scrobble', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The playback connection is unavailable.');
    const { executeJellyfinScrobble } = await import('$lib/sync/jellyfin');
    await executeJellyfinScrobble(action.userId, action.connectionId, action.payload);
  });
  register('trakt.scrobble', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeLiveScrobble } = await import('$lib/sync/trakt-export');
    await executeLiveScrobble(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.library', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { scanJellyfinLibrary } = await import('$lib/sync/jellyfin');
    let stage = 'connection';
    try {
      const result = await scanJellyfinLibrary(
        action.userId,
        action.connectionId,
        action.payload.full !== false,
        (next) => {
          stage = next;
        }
      );
      return { checked: result.checked };
    } catch (error) {
      tagDiagnosticStage(error, stage);
      throw error;
    }
  });
  register('jellyfin.sync', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { syncJellyfinUser } = await import('$lib/sync/jellyfin');
    let stage = 'connection';
    try { const result = await syncJellyfinUser(action.userId, action.connectionId, next => { stage = next; }); return { checked: result.checked }; }
    catch (error) { tagDiagnosticStage(error, stage); throw error; }
  });
  register('trakt.import', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { importTrakt } = await import('$lib/sync/trakt-import');
    await importTrakt(action.userId, action.connectionId, 'tracking');
  });
  register('trakt.lists-import', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The Trakt connection is unavailable.');
    const { importTrakt } = await import('$lib/sync/trakt-import');
    await importTrakt(action.userId, action.connectionId, 'lists');
  });
  register('trakt.list-export', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeTraktListExport } = await import('$lib/sync/trakt-lists');
    await executeTraktListExport(action.userId, action.connectionId, action.payload);
  });
  register('trakt.export', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeTraktExport } = await import('$lib/sync/trakt-export');
    await executeTraktExport(action.userId, action.connectionId, action.payload);
  });
  register('seerr.request', async (action) => {
    const requestId = v.parse(uuid, action.payload.requestId);
    const [request] = await getDb()
      .select()
      .from(mediaRequests)
      .where(and(eq(mediaRequests.id, requestId), eq(mediaRequests.userId, action.userId)));
    if (!request || request.state === 'cancelled') return;
    const [mapping] = await getDb()
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.mediaId, request.mediaId), eq(externalIds.provider, 'tmdb')));
    if (!mapping || !['movie', 'show'].includes(mapping.mediaKind))
      throw new PermanentActionError(
        'A TMDB movie or show identity is required to request media.'
      );
    const { adapter } = await getSeerr(action.userId, request.instanceId);
    const external = await adapter.create({
      kind: mapping.mediaKind as DiscoverKind,
      tmdbId: Number(mapping.externalId),
      is4k: request.is4k,
      seasons: request.seasons,
      serverId: request.serverId ?? undefined,
    });
    await getDb()
      .update(mediaRequests)
      .set({
        externalId: String(external.id),
        state:
          external.status === 2 ? 'approved' : external.status === 3 ? 'declined' : 'pending',
        updatedAt: new Date(),
      })
      .where(eq(mediaRequests.id, request.id));
  });
}
