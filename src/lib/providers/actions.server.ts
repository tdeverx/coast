import { requestPriority } from '$lib/server/security/request-priority';
import { getConfig } from '$lib/server/config';
import * as v from 'valibot';
import {
  registerActionHandler,
  enqueueAction,
  PermanentActionError,
  tagDiagnosticStage,
  type ActionHandler,
} from '$lib/server/queue';
import { ProviderActionError } from '$lib/providers/contracts';
import { connectionFor } from '$lib/providers/connections.server';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import { refreshRequests, executeSeerrRequest, executeSeerrManagement } from '$lib/providers/seerr/requests.server';
import { startProviderMaintenance } from '$lib/providers/maintenance.server';

const uuid = v.pipe(v.string(), v.uuid());

export function registerProviderActions(options: { maintenance?: boolean } = {}) {
  registerActionHandler('feature.reconcile', async action => (await import('$lib/application/feature-transition.server')).reconcileFeatures(action));
  registerActionHandler('benchmark.run', async action => (await import('$lib/benchmarks/service.server')).executeBenchmark(action));
  const register = (kind: string, handler: ActionHandler) =>
    registerActionHandler(kind, async (action) => {
      try {
        const config = await getConfig();
        if ((action.kind.startsWith('trakt.') && !config.enableTrakt) || (action.kind.startsWith('seerr.') && !config.enableRequests) || (action.kind.startsWith('steam.') && !config.experimentalGaming))
          throw new PermanentActionError('This service is disabled by the administrator.');
        return await handler(action);
      } catch (error) {
        if (error instanceof ProviderActionError) throw new PermanentActionError(error.message,error.code);
        throw error;
      }
    });
  register('taste.refresh',async()=> (await import('$lib/social/taste-cache.server')).refreshTasteCaches());
  register('planning.reminder',async action=>(await import('$lib/experiments/planning.server')).remindPlan(action.userId,v.parse(uuid,action.payload.planId)));
  register('webhook.deliver', async action => (await import('$lib/server/public-api/webhooks.server')).deliverWebhook(action));
  if (options.maintenance !== false) startProviderMaintenance();
  register('jellyfin.updates',async action=>(await import('$lib/providers/jellyfin/updates.server')).pollCompanion(action));
  register('jellyfin.delta',async action=>(await import('$lib/providers/jellyfin/updates.server')).applyCompanionDelta(action));
  register('jellyfin.streams',async action=>{
    let scanner;
    try{scanner=await import('$lib/providers/jellyfin/stream-history.server');}
    catch(error){tagDiagnosticStage(error,'streams-module');throw error;}
    return scanner.scanServerStreams(action);
  });
  register('igdb.steam-metadata', async action => (await import('$lib/providers/steam/sync.server')).syncSteamMetadata(action));
  register('steam.sync', async action => (await import('$lib/providers/steam/sync.server')).syncSteam(action));
  register('steam.achievements', async action => (await import('$lib/providers/steam/sync.server')).syncSteamAchievements(action));
  register('catalogue.user-scan', async action => (await import('$lib/catalogue/maintenance.server')).scanUserCatalogue(action));
  for(const provider of ['tmdb','igdb','trakt'])register(`${provider}.recommendations`,async action=>(await import('$lib/recommendations/providers.server')).refreshProviderRecommendations(action));
  register('tmdb.refresh', async action => {
    v.parse(v.object({ instanceId: uuid, force: v.optional(v.boolean(), false) }), action.payload);
    return (await import('$lib/catalogue/maintenance.server')).refreshSharedMetadata(action);
  });
  register('social.checkin-complete',async action=>{await (await import('$lib/social/presence.server')).completeCheckin(action.userId,v.parse(uuid,action.payload.checkinId));});
  for(const provider of ['jellyfin','steam'] as const)register(`${provider}.live`,async action=>{if(action.connectionId)return (await import('$lib/social/provider-live.server')).pollProviderLive(action.userId,action.connectionId,provider);});
  register('trakt.live',async action=>{if(action.connectionId)await (await import('$lib/social/trakt.server')).pollLive(action.userId,action.connectionId);});
  register('trakt.checkin',async action=>{if(action.connectionId)await (await import('$lib/social/trakt.server')).deliverCheckin(action.userId,action.connectionId,v.parse(uuid,action.payload.checkinId));});
  register('seerr.manage', executeSeerrManagement);
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
    const { executeProgressExport } = await import('$lib/sync/trakt-export.server');
    await executeProgressExport(action.userId, action.connectionId, action.payload);
  });
  register('seerr.sync', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Seerr connection is unavailable.');
    const { instance } = await connectionFor(action.userId, action.connectionId, 'seerr');
    await refreshRequests(action.userId, instance.id, {connectionId:action.connectionId,accountGeneration:action.accountGeneration!});
  });
  register('history.remove', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The connection is unavailable.');
    const { executeHistoryRemoval } = await import('$lib/sync/history-removal.server');
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
    const {executeJellyfinUserState}=await import('$lib/sync/jellyfin.server');await executeJellyfinUserState(action.userId,action.connectionId,action.payload);
  });
  register('jellyfin.user-state', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { executeJellyfinUserState } = await import('$lib/sync/jellyfin.server');
    await executeJellyfinUserState(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.scrobble', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The playback connection is unavailable.');
    const { executeJellyfinScrobble } = await import('$lib/sync/jellyfin.server');
    await executeJellyfinScrobble(action.userId, action.connectionId, action.payload);
  });
  register('trakt.scrobble', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeLiveScrobble } = await import('$lib/sync/trakt-export.server');
    await executeLiveScrobble(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.library', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { scanJellyfinLibrary } = await import('$lib/sync/jellyfin.server');
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
  register('jellyfin.bootstrap', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { bootstrapJellyfinUser } = await import('$lib/sync/jellyfin.server');
    let stage = 'connection';
    try {
      const result = await bootstrapJellyfinUser(action.userId, action.connectionId, next => { stage = next; });
      // Finish the bootstrap job and release its worker/account lane. A separate
      // background job completes availability without delaying another user joining.
      await enqueueAction({userId: action.userId, connectionId: action.connectionId, kind: 'jellyfin.sync', purpose: 'scheduled', payload: {}, compactionKey: 'jellyfin.sync'});
      return { checked: result.checked };
    }
    catch (error) { tagDiagnosticStage(error, stage); throw error; }
  });
  register('jellyfin.sync', async action => {
    if (!action.connectionId) throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const {syncJellyfinUser} = await import('$lib/sync/jellyfin.server');
    let stage = 'connection';
    try {
      const result = await requestPriority.run(3, () => syncJellyfinUser(action.userId, action.connectionId!, next => {stage = next;}));
      return {checked: result.checked};
    } catch (error) {tagDiagnosticStage(error, stage); throw error;}
  });
  register('trakt.import', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { importTrakt } = await import('$lib/sync/trakt-import.server');
    const result=await importTrakt(action.userId, action.connectionId, 'tracking',action.payload.initialImport===true);
    return {applied:result.imported,review:result.review};
  });
  register('trakt.lists-import', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The Trakt connection is unavailable.');
    const { importTrakt } = await import('$lib/sync/trakt-import.server');
    const result=await importTrakt(action.userId, action.connectionId, 'lists',action.payload.initialImport===true);
    return {applied:result.imported,review:result.review};
  });
  register('trakt.list-export', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeTraktListExport } = await import('$lib/sync/trakt-lists.server');
    await executeTraktListExport(action.userId, action.connectionId, action.payload);
  });
  register('trakt.export', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeTraktExport } = await import('$lib/sync/trakt-export.server');
    await executeTraktExport(action.userId, action.connectionId, action.payload);
  });
  register('seerr.request', executeSeerrRequest);
}
