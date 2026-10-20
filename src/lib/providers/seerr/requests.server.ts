import { requireFeature, requireFeatureInTransaction, getFeatureConfig } from '$lib/server/features';
import { context } from '$lib/server/diagnostics';
import { correlationId } from '$lib/diagnostics';
import { conflictPreference } from '$lib/sync/preference.server';
import * as v from 'valibot';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import {
  providerInstances,
  providerConnections,
  mediaRequests,
  media,
  externalIds,
  outboxActions,
  syncValues,
  providerJobSnapshots,
} from '$lib/server/db/schema';
import { enqueueAction, PermanentActionError, type OutboxAction } from '$lib/server/queue';
import {
  SeerrAdapter,
  groupDestination,
  seerrAllows,
  SeerrPermission,
  requestSchema,
  type SeerrRequest,
} from '$lib/providers/seerr/adapter.server';
import { ProviderActionError, type DiscoverKind } from '$lib/providers/contracts';
import { notifyMany } from '$lib/server/notifications';
import { trackInTransaction } from '$lib/core/tracking/service.server';
import { getInstance, instanceFetchConfig } from '$lib/providers/instances.server';
import { connectionFor } from '$lib/providers/connections.server';
import { getSeerr, assertSeerrAccount } from '$lib/providers/seerr/connection.server';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
import { jobExecution, jobCheckpoint, readJobCheckpoint, saveJobCheckpoint } from '$lib/server/queue/execution';

const uuid = v.pipe(v.string(), v.uuid());

type RequestOption = ReturnType<typeof groupDestination>[number] & {
  instanceId: string;
  connectionId: string;
  permissions: number;
  externalUserId: number;
  seasons: Awaited<ReturnType<SeerrAdapter['details']>>['seasons'];
  existing: Awaited<ReturnType<SeerrAdapter['details']>>['mediaInfo'];
  variants: { standard: RequestVariant | null; fourK: RequestVariant | null };
};

type RequestVariant = {
  serverId: number;
  requestable: boolean;
  seasons: { number: number; requested: boolean; mine: boolean; available: boolean }[];
};

type RequestCache = {
  at: number;
  linkedInstanceId: string;
  linkedUserId: string;
  options: RequestOption[];
};

export async function requestOptions(userId: string, mediaId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const config=await getFeatureConfig(userId);
  signal?.throwIfAborted();
  if (!config.features.requests||!config.features.screen) return [];
  const [item] = await getDb().select().from(media).where(eq(media.id, mediaId));
  signal?.throwIfAborted();
  const [mapping] = await getDb()
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, mediaId), eq(externalIds.provider, 'tmdb')));
  signal?.throwIfAborted();
  if (!item || !mapping || !['movie', 'show'].includes(item.kind)) return [];
  const instances = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'seerr'), eq(providerInstances.enabled, true)));
  const options: RequestOption[] = [];
  for (const instance of instances)
    try {
      signal?.throwIfAborted();
      const { adapter, account, connection, linkedJellyfinUserId } = await getSeerr(
          userId,
          instance.id, undefined, signal
        ),
        kind = item.kind as DiscoverKind;
      const [servers, details, local] = await Promise.all([
        adapter.servers(kind),
        adapter.details(kind, Number(mapping.externalId)),
        getDb()
          .select()
          .from(mediaRequests)
          .where(
            and(
              eq(mediaRequests.mediaId, mediaId),
              eq(mediaRequests.instanceId, instance.id),
              sql`${mediaRequests.state} in ('pending','approved','available')`
            )
          ),
      ]);
      signal?.throwIfAborted();
      const destinations = groupDestination(
        instance.id,
        instance.name,
        servers,
        account.permissions,
        kind
      );
      const verified: RequestOption[] = [];
      for (const destination of destinations) {
        const variant = (is4k: boolean, serverId: number | undefined) => {
          if (serverId === undefined || (is4k && !destination.can4k)) return null;
          const requested = (details.mediaInfo?.requests || []).filter(
            (r) =>
              r.status !== 3 &&
              r.is4k === is4k &&
              (r.serverId == null || r.serverId === serverId)
          );
          const pending = local.filter((r) => r.is4k === is4k && r.serverId === serverId);
          const seasons = details.seasons
            .filter((s) => s.episodeCount > 0)
            .map((s) => {
              const remote = requested.filter((r) =>
                r.seasons.some(
                  (season) => season.seasonNumber === s.seasonNumber && season.status !== 3
                )
              );
              const localScope = pending.filter((r) => r.seasons.includes(s.seasonNumber));
              return {
                number: s.seasonNumber,
                requested: remote.length > 0 || localScope.length > 0,
                mine:
                  remote.some((r) => r.requestedBy?.id === account.id) ||
                  localScope.some((r) => r.userId === userId),
                available: !!details.mediaInfo?.seasons.some(
                  (n) =>
                    n.seasonNumber === s.seasonNumber && (is4k ? n.status4k : n.status) === 5
                ),
              };
            });
          const requestable =
            kind === 'show'
              ? seasons.some((s) => !s.requested && !s.available)
              : !requested.length &&
                !pending.length &&
                (is4k ? details.mediaInfo?.status4k : details.mediaInfo?.status) !== 5;
          return { serverId, requestable, seasons };
        };
        const standard = variant(false, destination.standardServerId),
          fourK = variant(true, destination.fourKServerId);
        if (!standard?.requestable && !fourK?.requestable) continue;
        verified.push({
          ...destination,
          instanceId: instance.id,
          connectionId: connection.id,
          permissions: account.permissions,
          externalUserId: account.id,
          seasons: details.seasons,
          existing: details.mediaInfo,
          variants: { standard, fourK },
        });
      }
      options.push(...verified);
      const [saved] = await getDb()
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, connection.id));
      const cache = Object.fromEntries(
        Object.entries(
          (saved.settings.requestOptionsCache as Record<string, RequestCache>) || {}
        )
          .filter(([id, entry]) => id !== mediaId && Date.now() - entry.at < 30 * 60000)
          .slice(-19)
      );
      cache[mediaId] = {
        at: Date.now(),
        linkedInstanceId: instance.linkedMediaInstanceId!,
        linkedUserId: linkedJellyfinUserId,
        options: verified,
      };
      signal?.throwIfAborted();
      await getDb()
        .update(providerConnections)
        .set({
          settings: sql`${providerConnections.settings} || ${{ requestOptionsCache: cache }}::jsonb`,
        })
        .where(eq(providerConnections.id, connection.id));
    } catch (error) {
      signal?.throwIfAborted();
      // A recently verified dialog can still create durable work during an outage. Dispatch always rechecks it.
      const status = (error as { status?: number }).status;
      if (
        error instanceof ProviderActionError ||
        error instanceof v.ValiError ||
        (status !== undefined && status !== 429 && status < 500)
      )
        continue;
      try {
        await instanceFetchConfig(instance);
        const [connection] = await getDb()
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.userId, userId),
              eq(providerConnections.instanceId, instance.id),
              eq(providerConnections.status, 'connected')
            )
          );
        const cached = (
          connection?.settings.requestOptionsCache as Record<string, RequestCache> | undefined
        )?.[mediaId];
        if (
          !cached ||
          Date.now() - cached.at > 30 * 60000 ||
          cached.linkedInstanceId !== instance.linkedMediaInstanceId
        )
          continue;
        await getInstance(cached.linkedInstanceId, 'jellyfin');
        const [linked] = await getDb()
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.userId, userId),
              eq(providerConnections.instanceId, cached.linkedInstanceId),
              eq(providerConnections.status, 'connected'),
              eq(providerConnections.externalUserId, cached.linkedUserId)
            )
          );
        signal?.throwIfAborted();
        if (linked) options.push(...cached.options);
      } catch {
        signal?.throwIfAborted();
        /* Revoked policy or a missing verified account cannot use cached capabilities. */
      }
    }
  signal?.throwIfAborted();
  return options;
}

export async function requestMedia(userId: string, input: unknown) {
  await requireFeature(userId,'requests');
  await requireFeature(userId,'screen');
  const data = v.parse(
    v.object({
      mediaId: uuid,
      instanceId: uuid,
      is4k: v.optional(v.boolean(), false),
      seasons: v.optional(v.array(v.pipe(v.number(), v.integer(), v.minValue(0))), []),
      addToWatchlist: v.optional(v.boolean(), true),
    }),
    input
  );
  const duplicate = async () => {
    const existing = await getDb()
      .select()
      .from(mediaRequests)
      .where(
        and(
          eq(mediaRequests.userId, userId),
          eq(mediaRequests.mediaId, data.mediaId),
          eq(mediaRequests.instanceId, data.instanceId),
          eq(mediaRequests.is4k, data.is4k),
          sql`${mediaRequests.state} in ('pending','approved','available')`
        )
      );
    return existing.find((r) =>
      data.seasons.length
        ? data.seasons.every((n) => r.seasons.includes(n))
        : r.seasons.length === 0
    );
  };
  const prior = await duplicate();
  if (prior) return prior;
  const options = await requestOptions(userId, data.mediaId),
    destination = options.find((x) => x.instanceId === data.instanceId);
  if (!destination || (data.is4k && !destination.can4k)) {
    const existing = await duplicate();
    if (existing) return existing;
    throw new Error('This destination is not available for your account.');
  }
  const { connection } = await connectionFor(userId, destination.connectionId, 'seerr'),
    serverId = data.is4k ? destination.fourKServerId : destination.standardServerId;
  if (serverId === undefined) throw new Error('This quality variant is not configured.');
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  const requested = [...new Set(data.seasons)].sort((a, b) => a - b);
  if (
    item.kind === 'show' &&
    (!requested.length ||
      requested.some(
        (n) => !destination.seasons.some((s) => s.seasonNumber === n && s.episodeCount > 0)
      ))
  )
    throw new Error('Choose at least one valid season.');
  return getDb().transaction(async (tx) => {
    await requireFeatureInTransaction(tx,userId,'requests');
    await requireFeatureInTransaction(tx,userId,'screen');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`request:${data.mediaId}:${data.instanceId}:${serverId}:${data.is4k}`},0))`
    );
    const existing = await tx
      .select()
      .from(mediaRequests)
      .where(
        and(
          eq(mediaRequests.mediaId, data.mediaId),
          eq(mediaRequests.instanceId, data.instanceId),
          eq(mediaRequests.serverId, serverId),
          eq(mediaRequests.is4k, data.is4k),
          sql`${mediaRequests.state} in ('pending','approved','available')`
        )
      );
    const remote = (destination.existing?.requests || []).filter(
      (r) =>
        r.status !== 3 &&
        r.is4k === data.is4k &&
        (r.serverId == null || r.serverId === serverId)
    );
    const taken = new Set([
      ...existing.flatMap((r) => r.seasons),
      ...remote.flatMap((r) =>
        r.seasons.filter((s) => s.status !== 3).map((s) => s.seasonNumber)
      ),
      ...(destination.existing?.seasons || [])
        .filter((s) => (data.is4k ? s.status4k : s.status) === 5)
        .map((s) => s.seasonNumber),
    ]);
    const remaining = requested.filter((n) => !taken.has(n));
    if (
      !existing.length &&
      ((item.kind === 'movie' &&
        (remote.length ||
          (data.is4k ? destination.existing?.status4k : destination.existing?.status) === 5)) ||
        (item.kind === 'show' && !remaining.length))
    )
      throw new Error('This version or season selection is already available or requested.');
    if (existing.length && (item.kind === 'movie' || !remaining.length)) {
      const mine = existing.find((r) => r.userId === userId);
      if (mine) return mine;
      throw new Error('This version or season selection has already been requested.');
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${connection.id}`},0))`
    );
    const [request] = await tx
      .insert(mediaRequests)
      .values({
        userId,
        mediaId: data.mediaId,
        instanceId: data.instanceId,
        is4k: data.is4k,
        seasons: remaining,
        serverId,
        state: 'pending',
      })
      .returning();
    await tx.insert(outboxActions).values({
      correlationId: correlationId(context.getStore()),
      userId,
      connectionId: connection.id,
      kind: 'seerr.request',
      payload: { requestId: request.id },
      createdAt: sql`clock_timestamp()`,
    });
    if (data.addToWatchlist)
      await trackInTransaction(tx, userId, {
        mediaId: data.mediaId,
        action: 'watchlist',
        value: true,
      });
    return request;
  });
}

const seerrCheckpointSchema=v.object({task:v.literal('seerr-sync'),scanId:uuid,
  phase:v.picklist(['scanning','missing','conflicts','complete']),offset:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(100100)),
  next:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(100)),after:v.nullable(uuid)});
type SeerrCheckpoint=v.InferOutput<typeof seerrCheckpointSchema>;
const seerrPageSchema=v.object({task:v.literal('seerr-sync-page'),scanId:uuid,offset:v.number(),results:v.pipe(v.array(requestSchema),v.maxLength(100))});

/** A bounded page snapshot survives slow metadata work. The scan marker is
 * separate from visible status timestamps and never proves remote deletion. */
export async function refreshRequests(userId:string,instanceId:string,expected?:{connectionId:string;accountGeneration:string}) {
  const {adapter,connection,account,scope}=await getSeerr(userId,instanceId,expected);
  type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
  const db=getDb(),execution=jobExecution.getStore();
  const guarded=<T>(work:(tx:Tx)=>Promise<T>)=>db.transaction(async tx=>{await assertSeerrAccount(tx,scope);return work(tx);});
  await guarded(async()=>{});
  const saved=await readJobCheckpoint();
  let point:SeerrCheckpoint=saved?v.parse(seerrCheckpointSchema,saved):{task:'seerr-sync',scanId:crypto.randomUUID(),phase:'scanning',offset:0,next:0,after:null};
  const retain=async(tx:Tx,next:SeerrCheckpoint)=>{await saveJobCheckpoint(next,tx);point=next;};
  const expired=()=>!!execution&&performance.now()-execution.started>=10_000;
  const {importTmdb}=await import('$lib/catalogue/service.server');
  while(point.phase==='scanning'){
    if(point.offset>100000)throw new Error('Seerr request sync exceeded the supported page bound.');
    const [stored]=execution?await db.select().from(providerJobSnapshots).where(eq(providerJobSnapshots.actionId,execution.id)):[];
    if(!stored&&point.next>0){
      // A partial-page cursor is meaningful only with its original page. Older
      // installations may have expired it; restart a complete census instead
      // of slicing a newly fetched, potentially reordered response.
      await guarded(tx=>retain(tx,{task:'seerr-sync',scanId:crypto.randomUUID(),phase:'scanning',offset:0,next:0,after:null}));
      continue;
    }
    if(stored&&(stored.connectionId!==connection.id||stored.accountGeneration!==connection.accountGeneration))
      throw new PermanentActionError('The request scan account changed.');
    let page: v.InferOutput<typeof seerrPageSchema>;
    if(stored){
      page=v.parse(seerrPageSchema,stored.data);
      if(page.scanId!==point.scanId||page.offset!==point.offset)throw new PermanentActionError('The request scan page changed.');
    }else{
      await guarded(async()=>{});
      const remote=await adapter.requests(point.offset,false,account);
      page=v.parse(seerrPageSchema,{task:'seerr-sync-page',scanId:point.scanId,offset:point.offset,results:remote.results});
      if(execution)await guarded(async tx=>{
        await tx.insert(providerJobSnapshots).values({actionId:execution.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,data:page});
        await retain(tx,point);
      });
    }
    if(point.next>page.results.length)throw new PermanentActionError('The request scan cursor is invalid.');
    const remaining=page.results.slice(point.next),externalIds=remaining.map(remote=>String(remote.id));
    const known=externalIds.length?await db.select().from(mediaRequests).where(and(eq(mediaRequests.userId,userId),eq(mediaRequests.instanceId,instanceId),inArray(mediaRequests.externalId,externalIds))):[];
    const knownById=new Map(known.map(request=>[request.externalId,request]));
    type Prepared={remote:SeerrRequest;workId?:string};
    let pending:Prepared[]=[];
    async function commit(next:number,complete:boolean){
      await guarded(async tx=>{
        const ids=pending.map(({remote})=>String(remote.id));
        // Resolve the page again under the account fence: an interactive/direct
        // observation may have committed while metadata was being fetched.
        const current=ids.length?await tx.select().from(mediaRequests).where(and(eq(mediaRequests.userId,userId),eq(mediaRequests.instanceId,instanceId),inArray(mediaRequests.externalId,ids))):[];
        const byId=new Map(current.map(request=>[request.externalId,request]));
        const unchanged:string[]=[],insertions:typeof mediaRequests.$inferInsert[]=[],notices:{id:string;mediaId:string;remoteId:number;state:typeof mediaRequests.$inferSelect.state}[]=[];
        for(const {remote,workId} of pending){
          const state:typeof mediaRequests.$inferSelect.state=(remote.is4k?remote.media?.status4k:remote.media?.status)===5?'available':remote.status===2?'approved':remote.status===3?'declined':'pending';
          const local=byId.get(String(remote.id));
          if(local){
            if(local.state===state)unchanged.push(local.id);
            else{
              await tx.update(mediaRequests).set({state,observedScanId:point.scanId,updatedAt:new Date()}).where(eq(mediaRequests.id,local.id));
              notices.push({id:local.id,mediaId:local.mediaId,remoteId:remote.id,state});
            }
          }else if(workId)insertions.push({userId,instanceId,mediaId:workId,externalId:String(remote.id),serverId:remote.serverId,is4k:remote.is4k,seasons:remote.seasons.map(season=>season.seasonNumber),state,observedScanId:point.scanId});
        }
        if(unchanged.length)await tx.update(mediaRequests).set({observedScanId:point.scanId}).where(inArray(mediaRequests.id,unchanged));
        if(insertions.length)await tx.insert(mediaRequests).values(insertions);
        // Notification persistence and the cursor are one commit: a resumed page
        // must never skip a status change whose notification was not stored.
        await notifyMany(notices.map(notice=>({userId,kind:'request',title:notice.state==='available'?'Your requested title is available':`Request ${notice.state}`,
          sourceKey:`seerr:${instanceId}:${notice.remoteId}:${notice.state}`,data:{actorId:userId,subjectId:notice.id,workId:notice.mediaId,destination:'/requests' as const}})),tx);
        await retain(tx,complete?{...point,phase:page.results.length<100?'missing':'scanning',offset:point.offset+100,next:0,after:null}:{...point,next});
        if(complete&&execution)await tx.delete(providerJobSnapshots).where(eq(providerJobSnapshots.actionId,execution.id));
      });
      pending=[];
    }
    for(let index=point.next;index<page.results.length;index++){
      const remote=page.results[index];
      let workId:string|undefined;
      if(!knownById.has(String(remote.id))&&remote.media?.tmdbId){
        const kind=remote.type==='tv'||remote.media.mediaType==='tv'?'show':'movie';
        workId=(await importTmdb(kind,String(remote.media.tmdbId),{includeEpisodes:false})).id;
      }
      pending.push({remote,workId});
      if(expired()&&index+1<page.results.length){await commit(index+1,false);await jobCheckpoint();}
    }
    await commit(page.results.length,true);
    await jobCheckpoint();
  }
  while(point.phase==='missing'){
    const previous=await db.select().from(mediaRequests).where(and(eq(mediaRequests.userId,userId),eq(mediaRequests.instanceId,instanceId),
      sql`${mediaRequests.externalId} is not null`,sql`${mediaRequests.state}<>'cancelled'`,sql`${mediaRequests.observedScanId} is distinct from ${point.scanId}::uuid`,
      point.after?sql`${mediaRequests.id}>${point.after}::uuid`:undefined)).orderBy(asc(mediaRequests.id)).limit(100);
    if(!previous.length){await guarded(tx=>retain(tx,{...point,phase:'conflicts',after:null}));await jobCheckpoint();continue;}
    for(const request of previous){
      await guarded(async()=>{});
      let removed=false;
      try{await adapter.requestDetails(Number(request.externalId));}
      catch(error){if(!(error instanceof ProviderHttpError)||error.status!==404)throw error;removed=true;}
      await guarded(async tx=>{
        if(removed)await tx.update(mediaRequests).set({state:'cancelled',updatedAt:new Date()}).where(and(eq(mediaRequests.id,request.id),eq(mediaRequests.externalId,request.externalId!),sql`${mediaRequests.observedScanId} is not distinct from ${request.observedScanId}::uuid`));
        await retain(tx,{...point,after:request.id});
      });
      if(expired())await jobCheckpoint();
    }
    await jobCheckpoint();
  }
  while(point.phase==='conflicts'){
    const pending=await db.select().from(syncValues).where(and(eq(syncValues.connectionId,connection.id),eq(syncValues.conflict,true),sql`${syncValues.category} like 'request:%'`,
      point.after?sql`${syncValues.id}>${point.after}::uuid`:undefined)).orderBy(asc(syncValues.id)).limit(100);
    if(!pending.length){
      await guarded(async tx=>{
        await tx.update(providerConnections).set({settings:sql`jsonb_set(${providerConnections.settings},'{requestsVerifiedAt}',${JSON.stringify(new Date().toISOString())}::jsonb,true)`}).where(eq(providerConnections.id,connection.id));
        await retain(tx,{...point,phase:'complete',after:null});
      });
      break;
    }
    const ids=pending.map(entry=>entry.category.slice('request:'.length)).filter(id=>v.safeParse(uuid,id).success);
    const requests=ids.length?await db.select().from(mediaRequests).where(and(eq(mediaRequests.userId,userId),inArray(mediaRequests.id,ids))):[];
    const byId=new Map(requests.map(request=>[request.id,request]));
    for(const entry of pending){
      const request=byId.get(entry.category.slice('request:'.length));
      await guarded(async tx=>{
        if(request){
          const remote={value:request.state};
          await tx.update(syncValues).set({remote,updatedAt:new Date()}).where(and(eq(syncValues.id,entry.id),sql`${syncValues.remote} is distinct from ${remote}::jsonb`));
          const preference=await conflictPreference(tx,userId,connection.id);
          if(preference!=='manual'){
            const {resolveConflict}=await import('$lib/sync/conflicts.server');
            await resolveConflict(userId,entry.id,preference==='remote'?'accepted':'ignored',tx);
          }
        }
        await retain(tx,{...point,after:entry.id});
      });
      if(expired())await jobCheckpoint();
    }
    await jobCheckpoint();
  }
}

export async function manageRequest(
  userId: string,
  requestId: string,
  action: 'cancel' | 'approve' | 'decline'
) {
  const [request] = await getDb()
    .select()
    .from(mediaRequests)
    .where(eq(mediaRequests.id, requestId));
  if (!request) throw new Error('Request not found.');
  if (!request.externalId) {
    if (request.userId !== userId || action !== 'cancel')
      throw new Error('This request cannot be changed.');
    await getDb().transaction(async (tx) => {
      const cancelled = await tx
        .update(outboxActions)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(outboxActions.userId, userId),
            eq(outboxActions.kind, 'seerr.request'),
            sql`${outboxActions.state} in ('pending','failed')`,
            sql`${outboxActions.payload}->>'requestId' = ${requestId}`
          )
        )
        .returning();
      if (!cancelled.length)
        throw new Error(
          'This request is being sent. Wait for its status to update before cancelling.'
        );
      await tx
        .update(mediaRequests)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(eq(mediaRequests.id, requestId));
    });
    return;
  }
  const [connection] = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, request.instanceId),
        eq(providerConnections.status, 'connected')
      )
    );
  if (!connection) throw new Error('Connect your linked account before changing requests.');
  const manager = seerrAllows(
    Number(connection.settings.seerrPermissions) || 0,
    SeerrPermission.MANAGE_REQUESTS
  );
  if (
    action === 'cancel'
      ? !manager && (request.userId !== userId || request.state !== 'pending')
      : !manager
  )
    throw new Error('You do not have permission to change this request.');
  await enqueueAction({
    userId,
    connectionId: connection.id,
    kind: 'seerr.manage',
    payload: { requestId, action, expectedState: request.state },
  });
}

/** Delivery resolves an existing queued identity; it must never link a replacement
 * while its worker holds that connection's account lane. */
function queuedSeerrAccount(action: OutboxAction) {
  if (!action.connectionId || !action.accountGeneration)
    throw new PermanentActionError('The queued request account is unavailable.');
  return { connectionId: action.connectionId, accountGeneration: action.accountGeneration };
}

/** Authenticated account resolution is injectable for disposable provider fixtures. */
export async function executeSeerrRequest(action: OutboxAction, resolveAccount: typeof getSeerr = getSeerr) {
  await requireFeature(action.userId,'requests');
  await requireFeature(action.userId,'screen');
  const requestId = v.parse(uuid, action.payload.requestId);
  const [request] = await getDb().select().from(mediaRequests)
    .where(and(eq(mediaRequests.id,requestId),eq(mediaRequests.userId,action.userId)));
  if (!request || request.state === 'cancelled') return;
  const [mapping] = await getDb().select().from(externalIds)
    .where(and(eq(externalIds.mediaId,request.mediaId),eq(externalIds.provider,'tmdb')));
  if (!mapping || !['movie','show'].includes(mapping.mediaKind))
    throw new PermanentActionError('A TMDB movie or show identity is required to request media.');
  const { adapter, scope } = await resolveAccount(action.userId,request.instanceId,queuedSeerrAccount(action));
  const external = await adapter.create({kind:mapping.mediaKind as DiscoverKind,tmdbId:Number(mapping.externalId),
    is4k:request.is4k,seasons:request.seasons,serverId:request.serverId ?? undefined});
  await getDb().transaction(async tx => {
    await assertSeerrAccount(tx,scope);
    await tx.update(mediaRequests).set({externalId:String(external.id),
      state:external.status===2?'approved':external.status===3?'declined':'pending',updatedAt:new Date()})
      .where(eq(mediaRequests.id,request.id));
  });
}

export async function executeSeerrManagement(action: OutboxAction, resolveAccount: typeof getSeerr = getSeerr) {
  const data = v.parse(v.object({requestId:uuid,action:v.picklist(['cancel','approve','decline']),
    resolved:v.optional(v.boolean(),false),expectedState:v.optional(v.string())}),action.payload);
  const [request] = await getDb().select().from(mediaRequests).where(eq(mediaRequests.id,data.requestId));
  if (!request?.externalId) return;
  const { adapter, connection, scope } = await resolveAccount(action.userId,request.instanceId,queuedSeerrAccount(action));
  const desired = data.action==='cancel'?'cancelled':data.action==='approve'?'approved':'declined';
  if (!data.resolved) {
    let remoteState: typeof mediaRequests.$inferSelect.state;
    try {
      const remote = await adapter.requestDetails(Number(request.externalId));
      remoteState = (remote.is4k?remote.media?.status4k:remote.media?.status)===5?'available'
        :remote.status===2?'approved':remote.status===3?'declined':'pending';
    } catch (error) {
      if ((error as {status?:number}).status!==404) throw error;
      remoteState='cancelled';
    }
    if (remoteState!==(data.expectedState ?? request.state) && remoteState!==desired) {
      const handled = await getDb().transaction(async tx => {
        await assertSeerrAccount(tx,scope);
        const preference = await conflictPreference(tx,action.userId,connection.id);
        if (preference==='local') return false;
        if (preference==='remote') {
          await tx.update(mediaRequests).set({state:remoteState,updatedAt:new Date()}).where(eq(mediaRequests.id,request.id));
          await tx.update(syncValues).set({conflict:false,agreed:{value:remoteState},remote:{value:remoteState},updatedAt:new Date()})
            .where(and(eq(syncValues.connectionId,connection.id),eq(syncValues.category,`request:${request.id}`)));
        } else {
          const values={remote:{value:remoteState},agreed:{value:desired},conflict:true,updatedAt:new Date()};
          await tx.insert(syncValues).values({connectionId:connection.id,mediaId:request.mediaId,category:`request:${request.id}`,...values})
            .onConflictDoUpdate({target:[syncValues.connectionId,syncValues.mediaId,syncValues.category],set:values});
        }
        return true;
      });
      if (handled) return;
    }
  }
  await getDb().transaction(tx => assertSeerrAccount(tx,scope));
  await adapter.manage(Number(request.externalId),data.action);
  await getDb().transaction(async tx => {
    await assertSeerrAccount(tx,scope);
    await tx.update(syncValues).set({conflict:false,agreed:{value:desired},remote:{value:desired},updatedAt:new Date()})
      .where(and(eq(syncValues.connectionId,connection.id),eq(syncValues.category,`request:${request.id}`)));
    await tx.update(mediaRequests).set({state:desired,updatedAt:new Date()}).where(eq(mediaRequests.id,request.id));
  });
}
