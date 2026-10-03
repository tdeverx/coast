import { persistMusic, observeMusicAccess, recordMusicListen, importedListenBatch } from '$lib/music/persistence.server';
import { enqueueInTransaction } from '$lib/sync/changes';
import {
  reconcileProviderValue,
  acknowledgeProviderValue,
  localSyncValue,
  sameValue,
} from '$lib/sync/values';
import { importJellyfinPlayback } from '$lib/sync/jellyfin-playback';
import { artworkKeys } from '$lib/artwork';
import * as v from 'valibot';
import { and, eq, isNull, ne, or, sql, desc, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  availability,
  providerItems,
  syncCheckpoints,
  seasons,
  providerConnections,
  trackingState,
  outboxActions,
  providerInstances,
  media,
  users,
  works, musicProgress, reconciliationIntents, syncValues,
} from '$lib/server/db/schema';
import { PermanentActionError } from '$lib/server/queue';
import { notify } from '$lib/server/notifications';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { getConfig } from '$lib/server/config';
import { ingestMetadata } from '$lib/catalogue/service';
import type { AvailableItem } from '$lib/providers/contracts';

export type JellyfinSyncContext=Awaited<ReturnType<typeof getJellyfin>>;
async function jellyfinContext(userId:string,connectionId:string,provided?:JellyfinSyncContext){
  if(!provided)return getJellyfin(userId,connectionId);
  const [current]=await getDb().select({connection:providerConnections,instance:providerInstances}).from(providerConnections)
    .innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).innerJoin(users,eq(users.id,providerConnections.userId))
    .where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.status,'connected'),eq(users.disabled,false),eq(providerInstances.enabled,true)));
  if(!current||current.instance.provider!=='jellyfin'||current.connection.accountGeneration!==provided.connection.accountGeneration||current.instance.id!==provided.instance.id)
    throw new PermanentActionError('The connected account changed during this task.');
  return {...current,adapter:provided.adapter};
}

export async function libraryScanProgress(userId: string, connectionId: string, since?:Date) {
  const { connection } = await getJellyfin(userId, connectionId);
  const [job] = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(
        eq(outboxActions.userId, userId),
        eq(outboxActions.connectionId, connectionId),
        eq(outboxActions.kind, 'jellyfin.sync'),
        since ? sql`${outboxActions.createdAt} >= ${since}` : undefined
      )
    )
    .orderBy(desc(outboxActions.createdAt))
    .limit(1);
  if (!job) return null;
  const parsed = v.safeParse(
    v.object({
      processed: v.number(),
      total: v.nullable(v.number()),
      startedAt: v.string(),
      phase: v.picklist(['scanning', 'reconciling', 'complete']),
    }),
    connection.settings.userSync
  );
  const current =
    parsed.success && new Date(parsed.output.startedAt) >= job.createdAt ? parsed.output : null;
  const [checkpoint] = current
    ? []
    : await getDb()
        .select()
        .from(syncCheckpoints)
        .where(
          and(
            eq(syncCheckpoints.connectionId, connectionId),
            eq(syncCheckpoints.kind, 'jellyfin-user')
          )
        )
        .limit(1);
  const checkpointCount =
    checkpoint && checkpoint.updatedAt >= job.createdAt ? Number(checkpoint.cursor ?? 0) : 0;
  return {
    state: job.state,
    processed: current?.processed ?? (Number.isSafeInteger(checkpointCount) ? checkpointCount : 0),
    total: current?.total ?? null,
    phase: current?.phase ?? 'scanning',
    error: job.lastError,
    authenticationFailed: (job.payload._jobFailure as {code?:string}|undefined)?.code==='provider.authentication',
    attempts: job.attempts,
  };
}

/** Resume at committed page boundaries; removal only occurs after a successful full traversal. */
export async function scanJellyfinLibrary(
  userId: string,
  connectionId: string,
  full = true,
  onStage?: (stage: string) => void
) {
  return runJellyfinScan(userId, connectionId, 'library', full, onStage);
}

export async function syncJellyfinUser(
  userId: string,
  connectionId: string,
  onStage?: (stage: string) => void,
  provided?: JellyfinSyncContext
) {
  return runJellyfinScan(userId, connectionId, 'user', true, onStage,provided);
}

async function runJellyfinScan(
  userId: string,
  connectionId: string,
  scope: 'library' | 'user',
  full = true,
  onStage?: (stage: string) => void,
  provided?: JellyfinSyncContext
) {
  onStage?.('connection');
  const { adapter, connection, instance } = await jellyfinContext(userId, connectionId,provided);
  onStage?.('identity');
  await adapter.identity(instance.serverIdentity || undefined);
  onStage?.('checkpoint-read');
  const db = getDb(),
    kind = scope === 'user' ? 'jellyfin-user' : full ? 'jellyfin-full' : 'jellyfin-recent';
  const [checkpoint] = await db
    .select()
    .from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
  const scanId = checkpoint?.cursor && checkpoint.scanId ? checkpoint.scanId : crypto.randomUUID();
  let offset = checkpoint?.cursor ? Number(checkpoint.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
  const previousScan = instance.settings.libraryScan as Record<string, unknown> | undefined;
  const completedAt =
    checkpoint?.completedAt?.getTime() ??
    Math.max(
      Date.parse(String(previousScan?.fullCompletedAt ?? '')) || 0,
      Date.parse(String(previousScan?.recentCompletedAt ?? '')) || 0
    );
  const since = !full && completedAt ? new Date(completedAt - 60000).toISOString() : undefined;
  const scanProgress=(scope==='library'?previousScan:connection.settings.userSync) as {scanId?:string;startedAt?:string}|undefined;
  const retainedStart=scanProgress?.startedAt;
  const startedAt = checkpoint?.scanId===scanProgress?.scanId && retainedStart && Number.isFinite(Date.parse(retainedStart)) ? retainedStart : new Date().toISOString();
  // If progress no longer belongs to this checkpoint, restart rather than skip changed pages.
  if(offset>0 && startedAt!==retainedStart)offset=0;
  async function report(processed: number, total: number | null, phase = 'scanning') {
    const progress = { processed, total, phase, startedAt, scanId };
    if (scope === 'library')
      await db
        .update(providerInstances)
        .set({
          settings: sql`jsonb_set(${providerInstances.settings}, '{libraryScan}', coalesce(${providerInstances.settings}->'libraryScan', '{}'::jsonb) || ${progress}::jsonb, true)`,
        })
        .where(eq(providerInstances.id, instance.id));
    else
      await db
        .update(providerConnections)
        .set({
          settings: sql`jsonb_set(${providerConnections.settings}, '{userSync}', ${progress}::jsonb, true)`,
        })
        .where(
          and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))
        );
  }
  // Mark traversal before its first remote request. An interrupted first page
  // cannot leave earlier negative observations looking like current coverage.
  await db.insert(syncCheckpoints).values({connectionId,kind,cursor:String(offset),scanId,updatedAt:new Date()})
    .onConflictDoUpdate({target:[syncCheckpoints.connectionId,syncCheckpoints.kind],set:{cursor:String(offset),scanId,updatedAt:new Date()}});
  await report(offset, null);
  const visited = new Map<string, string>();
  const knownItems = new Map<
    string,
    { providerItem: typeof providerItems.$inferSelect; saved: typeof media.$inferSelect }
  >();
  async function ensureConnected() {
    const [current] = await db
      .select({ settings: providerConnections.settings })
      .from(providerConnections)
      .innerJoin(users, eq(users.id, providerConnections.userId))
      .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
      .where(
        and(
          eq(providerConnections.id, connectionId),
          eq(providerConnections.userId, userId),
          eq(providerConnections.externalUserId, connection.externalUserId!),
          eq(providerConnections.accountGeneration, connection.accountGeneration),
          eq(providerConnections.status, 'connected'),
          eq(users.disabled, false),
          eq(providerInstances.enabled, true)
        )
      );
    if (!current) throw new PermanentActionError('The connected account changed during this task.');
    return current;
  }
  let importPlayback = connection.settings.importPlayback !== false;
  const importItem = async (item: AvailableItem, ancestry = new Set<string>()): Promise<string> => {
    if (visited.has(item.id)) return visited.get(item.id)!;
    if (ancestry.has(item.id)) throw new Error('Jellyfin returned a cyclic media hierarchy.');
    ancestry.add(item.id);
    const [known] = knownItems.has(item.id)
      ? [knownItems.get(item.id)!]
      : scope === 'user'
        ? await db
            .select({ providerItem: providerItems, saved: media })
            .from(providerItems)
            .innerJoin(media, eq(media.id, providerItems.mediaId))
            .where(
              and(eq(providerItems.instanceId, instance.id), eq(providerItems.externalId, item.id))
            )
            .limit(1)
        : [];
    // An account may see a title outside the source account's libraries. Fill that single
    // missing identity once, without re-importing the catalogue for every user.
    if (scope === 'user' && !known) item = await adapter.item(connection.externalUserId!, item.id);
    let showId: string | undefined, seasonId: string | undefined;
    if (!known && (item.kind === 'episode' || item.kind === 'season')) {
      if (!item.showId) throw new Error('Jellyfin returned an item without its show identity.');
      const [parent] = await db
        .select()
        .from(providerItems)
        .where(
          and(eq(providerItems.instanceId, instance.id), eq(providerItems.externalId, item.showId))
        )
        .limit(1);
      showId =
        parent?.mediaId ||
        (await importItem(await adapter.item(connection.externalUserId!, item.showId), ancestry));
      if (item.kind === 'episode') {
        const [existing] = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, item.seasonNumber ?? 0)));
        if (existing) seasonId = existing.mediaId;
        else if (item.parentId)
          seasonId = await importItem(
            await adapter.item(connection.externalUserId!, item.parentId),
            ancestry
          );
      }
    }
    item.metadata.artwork = Object.fromEntries(
      artworkKeys.flatMap((type) => {
        const image = item.artwork?.[type];
        return image
          ? [
              [
                type,
                `/api/v1/artwork/${instance.id}/${encodeURIComponent(item.id)}/${type}?tag=${encodeURIComponent(image.tag)}&index=${image.index}`,
              ],
            ]
          : [];
      })
    );
    item.metadata.posterPath = item.metadata.artwork.primary;
    item.metadata.backdropPath = item.metadata.artwork.backdrop;
    const saved =
      known?.saved ??
      (await ingestMetadata(item.metadata, {
        instanceId: instance.id,
        showId,
        seasonId,
        isolateConflictingProviderIds: true,
      }));
    visited.set(item.id, saved.id);
    const [providerItem] = known
      ? [known.providerItem]
      : await db
          .insert(providerItems)
          .values({
            instanceId: instance.id,
            externalId: item.id,
            kind: item.kind,
            mediaId: saved.id,
            snapshot: { ...item.metadata },
            lastSeenAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [providerItems.instanceId, providerItems.externalId],
            set: { mediaId: saved.id, snapshot: { ...item.metadata }, lastSeenAt: new Date() },
          })
          .returning();
    if (item.expectedMembers !== undefined) await db.update(providerItems).set({snapshot:sql`${providerItems.snapshot} || jsonb_build_object('expectedMembers',${item.expectedMembers}::integer)`}).where(eq(providerItems.id,providerItem.id));
    if (scope === 'library') return saved.id;
    const [wasAvailable] = await db
      .select({ id: availability.id })
      .from(availability)
      .where(
        and(
          eq(availability.userId, userId),
          eq(availability.mediaId, saved.id),
          eq(availability.state, 'available')
        )
      )
      .limit(1);
    const sources = item.sources.length
      ? item.sources
      : [
          {
            id: 'default',
            name: 'Original',
            container: undefined,
            bitrate: undefined,
            durationSeconds: item.metadata.runtimeMinutes
              ? item.metadata.runtimeMinutes * 60
              : undefined,
            streams: [],
            raw: {},
          },
        ];
    for (const source of sources) {
      const video = source.streams.find((s) => s.type === 'Video'),
        audio = source.streams.find((s) => s.type === 'Audio');
      const data = {
        userId,
        connectionId,
        providerItemId: providerItem.id,
        mediaId: saved.id,
        sourceId: source.id,
        edition: source.name,
        container: source.container,
        videoCodec: video?.codec,
        audioCodec: audio?.codec,
        bitrate: source.bitrate,
        width: video?.width,
        height: video?.height,
        durationSeconds: source.durationSeconds,
        source: { ...source.raw, ...(scope==='user' ? {coastUserData:item.userData??null} : {}) },
        state: 'available' as const,
        verifiedAt: new Date(),
        scanId,
      };
      await db
        .insert(availability)
        .values(data)
        .onConflictDoUpdate({
          target: [
            availability.userId,
            availability.connectionId,
            availability.providerItemId,
            availability.sourceId,
          ],
          set: data,
        });
    }
    if (!wasAvailable) {
      const [state] = await db
        .select()
        .from(trackingState)
        .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, saved.id)));
      if (state?.watchlist)
        await notify({
          userId,
          kind: 'availability',
          title: `${saved.title} is available`,
          body: 'A title on your watchlist is now in your library.',
          sourceKey: `available:${saved.id}`,
          data:{actorId:userId,subjectId:saved.id,workId:saved.id,destination:`/media/${saved.id}`},
        });
    }

    return saved.id;
  };
  let count = 0,
    processed = offset,
    total: number | null = null;
  for (;;) {
    onStage?.('library-page');
    const current = await ensureConnected();
    importPlayback = !!current && current.settings.importPlayback !== false;
    const page = await adapter.library(connection.externalUserId!, offset, since, scope);
    await ensureConnected();
    visited.clear();
    knownItems.clear();
    if (scope === 'user' && page.items.length) {
      const mapped = await db
        .select({ providerItem: providerItems, saved: media })
        .from(providerItems)
        .innerJoin(media, eq(media.id, providerItems.mediaId))
        .where(
          and(
            eq(providerItems.instanceId, instance.id),
            inArray(
              providerItems.externalId,
              page.items.map((item) => item.id)
            )
          )
        );
      for (const row of mapped) knownItems.set(row.providerItem.externalId, row);
    }
    total = page.total;
    await report(offset, page.total);
    onStage?.('item-import');
    for (const [index, item] of page.items.entries()) {
      await importItem(item);
      count++;
      if ((index + 1) % 25 === 0 || index === page.items.length - 1)
        await report(offset + index + 1, page.total);
    }
    onStage?.('checkpoint-write');
    await db
      .insert(syncCheckpoints)
      .values({
        connectionId,
        kind,
        cursor: page.nextOffset === null ? null : String(page.nextOffset),
        scanId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [syncCheckpoints.connectionId, syncCheckpoints.kind],
        set: {
          cursor: page.nextOffset === null ? null : String(page.nextOffset),
          scanId,
          updatedAt: new Date(),
        },
      });
    if (page.nextOffset === null) {
      processed = offset + page.items.length;
      await report(processed, page.total, 'reconciling');
      break;
    }
    offset = page.nextOffset;
  }
  // Multiple accessible editions may disagree. Apply one account-level observation
  // per canonical title after a complete traversal; persisted access snapshots also
  // survive checkpoints/retries without retaining the entire catalogue in memory.
  if(scope==='user' && (await ensureConnected()).settings.importPlayback!==false) {
    const observed=await db.execute<{id:string;kind:AvailableItem['kind'];played:boolean;favourite:boolean|null;position:number;playCount:number;lastPlayedAt:string|null;duration:number|null}>(sql`
      select a.media_id as id,m.kind,bool_or((a.source->'coastUserData'->>'played')::boolean) as played,
        bool_or((a.source->'coastUserData'->>'favourite')::boolean) as favourite,
        coalesce((array_agg((a.source->'coastUserData'->>'positionSeconds')::double precision order by
          case when (a.source->'coastUserData'->>'positionSeconds')::double precision>0 then 1 else 0 end desc,
          a.source->'coastUserData'->>'lastPlayedAt' desc nulls last,a.verified_at desc,a.provider_item_id))[1],0) as position,
        max((a.source->'coastUserData'->>'playCount')::integer) as "playCount",
        max(a.source->'coastUserData'->>'lastPlayedAt') as "lastPlayedAt",max(a.duration_seconds) as duration
      from availability a join media m on m.id=a.media_id
      where a.user_id=${userId} and a.connection_id=${connectionId} and a.scan_id=${scanId} and a.state='available'
        and jsonb_typeof(a.source->'coastUserData')='object'
      group by a.media_id,m.kind order by a.media_id`);
    for(const row of observed) {
      if((await ensureConnected()).settings.importPlayback===false)break;
      await importJellyfinPlayback(userId,connectionId,row.id,{
        kind:row.kind,metadata:{},sources:row.duration===null?[]:[{durationSeconds:row.duration}],
        userData:{played:row.played,favourite:row.favourite??undefined,positionSeconds:row.position,playCount:row.playCount,lastPlayedAt:row.lastPlayedAt??undefined},
      },connection.accountGeneration);
    }
  }
  // Metadata and per-user access remain separate for music, within the same service task.
  for(const musicKind of (await getConfig()).experimentalMusic?['album','track'] as const:[]){
    let musicOffset=0;for(;;){
      importPlayback=(await ensureConnected()).settings.importPlayback!==false;
      const page=await adapter.musicLibrary(connection.externalUserId!,{kind:musicKind,offset:musicOffset,limit:100});
      await ensureConnected();
      for(const item of page.items){
        const saved=scope==='user'?await observeMusicAccess(userId,connectionId,instance.id,item,scanId):await persistMusic(instance.id,item);
        if(scope==='user' && saved.workId && importPlayback){
          if(item.favourite!==undefined)await reconcileProviderValue(userId,connectionId,saved.workId,'favourite',{value:item.favourite},{source:'jellyfin'});
          if(item.kind==='track'){
            const count=Math.max(0,Math.min(item.playCount??0,10000));
            await reconcileProviderValue(userId,connectionId,saved.workId,'history',{value:count>0,playCount:count},{source:'jellyfin',apply:async tx=>{
              let added=0;
              const [baseline]=await tx.select().from(syncValues).where(and(eq(syncValues.connectionId,connectionId),eq(syncValues.mediaId,saved.workId!),eq(syncValues.category,'history')));
              const local=await localSyncValue(tx,userId,saved.workId!,'history');
              const observed=Number(baseline?.remote.playCount??local.playCount??0);
              for(let n=Math.min(count,observed);n<count;n++)if(await recordMusicListen(tx,userId,saved.workId!,importedListenBatch(connection.syncAccountId??connectionId,item.id,n),'jellyfin',undefined,false))added++;
              await tx.insert(musicProgress).values({userId,trackId:saved.workId!,playCount:count}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:count,updatedAt:new Date()}});
              return {changed:added>0};
            }});
            await reconcileProviderValue(userId,connectionId,saved.workId,'progress',{positionSeconds:Math.round((item.positionSeconds??0)*1000)/1000,durationSeconds:Math.round(item.durationSeconds??0)},{source:'jellyfin'});
          }
        }
      }
      if(page.nextOffset===null)break;musicOffset=page.nextOffset;
    }
  }
  // Complete known membership is a metadata property; this never grants another user access.
  if ((await getConfig()).experimentalMusic) await db.execute(sql`update music_works m set membership_complete=exists(select 1 from provider_items pi where pi.media_id=m.id and pi.instance_id=${instance.id} and (pi.snapshot->>'expectedMembers')::integer=(select count(*) from media_relationships r join music_works t on t.id=r.child_id where r.parent_id=m.id and r.kind='contains' and t.kind='track')) where m.kind='album' and exists(select 1 from provider_items pi where pi.media_id=m.id and pi.instance_id=${instance.id} and pi.snapshot->>'expectedMembers' is not null)`);
  // A complete traversal can confirm a provider's advertised known membership, not server-wide coverage.
  await db.execute(sql`update provider_items pi set snapshot=pi.snapshot || jsonb_build_object('membershipComplete',(pi.snapshot->>'expectedMembers')::integer=(select count(*) from episodes e where (pi.kind='show' and e.show_id=pi.media_id or pi.kind='season' and e.season_id=pi.media_id)))
    where pi.instance_id=${instance.id} and pi.kind in ('show','season') and pi.snapshot->>'expectedMembers' is not null`);
  if(scope==='user' && (await ensureConnected()).settings.reconcileTracking===true){
    await db.transaction(async tx=>{
      // Include state imported while no mapping existed, without treating empty rows as intent.
      const states=await tx.select().from(trackingState).where(and(eq(trackingState.userId,userId),sql`(${trackingState.favourite} or ${trackingState.watched} or ${trackingState.positionSeconds}>0)`));
      for(const state of states)for(const [category,value] of [['favourite',{value:state.favourite}],['history',{value:state.watched}],['progress',{positionSeconds:state.positionSeconds,durationSeconds:state.durationSeconds??0}]] as const){
        if(category==='progress'?state.positionSeconds<=0:!value.value)continue;
        await tx.insert(reconciliationIntents).values({connectionId,workId:state.mediaId,category,value}).onConflictDoNothing();
      }
      const music=await tx.select().from(musicProgress).where(eq(musicProgress.userId,userId));
      for(const state of music){
        if(state.playCount>0)await tx.insert(reconciliationIntents).values({connectionId,workId:state.trackId,category:'history',value:{value:true,playCount:state.playCount}}).onConflictDoNothing();
        if(state.positionSeconds>0)await tx.insert(reconciliationIntents).values({connectionId,workId:state.trackId,category:'progress',value:{positionSeconds:state.positionSeconds,durationSeconds:state.durationSeconds??0}}).onConflictDoNothing();
      }
      const intents=await tx.select().from(reconciliationIntents).where(and(eq(reconciliationIntents.connectionId,connectionId),sql`exists(select 1 from availability a where a.connection_id=${connectionId} and a.media_id=${reconciliationIntents.workId} and a.scan_id=${scanId} and a.state='available')`));
      for(const intent of intents)await enqueueInTransaction(tx,{userId,connectionId,kind:'jellyfin.reconcile',payload:{mediaId:intent.workId,field:intent.category==='history'?'watched':intent.category,value:intent.category==='progress'?Number(intent.value.positionSeconds):Boolean(intent.value.value),playCount:intent.value.playCount,durationSeconds:intent.value.durationSeconds,intentVersion:intent.version,backfill:true},compactionKey:`jellyfin-reconcile:${intent.workId}:${intent.category}`});
    });
  }
  onStage?.('reconcile');
  await ensureConnected();
  await db.transaction(async (tx) => {
    if (scope === 'user')
      await tx
        .update(availability)
        .set({ state: 'unavailable', verifiedAt: new Date() })
        .where(
          and(
            eq(availability.userId, userId),
            eq(availability.connectionId, connectionId),
            or(ne(availability.scanId, scanId), isNull(availability.scanId))
          )
        );
    await tx
      .update(syncCheckpoints)
      .set({ cursor: null, scanId: null, completedAt: new Date(startedAt), updatedAt: new Date() })
      .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
    if(scope==='user'){const {enqueueCollectionProjectionInTransaction}=await import('$lib/sync/changes');await enqueueCollectionProjectionInTransaction(tx,userId);}
  });
  onStage?.('complete');
  await report(processed, total, 'complete');
  if (scope === 'library') {
    const completion = {
      connectionId,
      externalUserId: connection.externalUserId,
      [full ? 'fullCompletedAt' : 'recentCompletedAt']: startedAt,
    };
    await db
      .update(providerInstances)
      .set({
        settings: sql`jsonb_set(${providerInstances.settings}, '{libraryScan}', coalesce(${providerInstances.settings}->'libraryScan', '{}'::jsonb) || ${completion}::jsonb, true)`,
      })
      .where(eq(providerInstances.id, instance.id));
  }
  return { count, full, checked: processed };
}

export async function executeJellyfinUserState(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>,
  provided?: JellyfinSyncContext
) {
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      field: v.picklist(['watched', 'favourite', 'progress']),
      value: v.union([v.boolean(), v.pipe(v.number(), v.minValue(0))]),
      durationSeconds: v.optional(v.number()),
      playCount: v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(2147483647))),
      intentVersion: v.optional(v.pipe(v.string(),v.uuid())),
      backfill: v.optional(v.boolean(),false),
    }),
    input
  );
  const { adapter, connection,instance } = await jellyfinContext(userId, connectionId,provided);
  if(data.backfill && connection.settings.reconcileTracking!==true)return;
  await adapter.identity(instance.serverIdentity||undefined);
  const items = await getDb()
    .selectDistinct({ id: providerItems.externalId })
    .from(availability)
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.connectionId, connectionId),
        eq(availability.mediaId, data.mediaId),
        eq(availability.state, 'available')
      )
    );
  const category = data.field === 'watched' ? 'history' : data.field;
  let desired:Record<string,unknown> =
    category === 'progress'
      ? { positionSeconds: Math.round(Number(data.value)*1000)/1000, durationSeconds: Math.round(data.durationSeconds ?? 0) }
      : { value: Boolean(data.value) };
  const current = await getDb().transaction((tx) =>
    localSyncValue(tx, userId, data.mediaId, category)
  );
  if(category==='history'&&'playCount' in current)desired={...desired,playCount:data.playCount??(data.value?current.playCount:0)};
  if (!sameValue(current, desired)) return;
  if(!items.length)return; // Durable intent remains; a future successful user sync can deliver it.
  const [work]=await getDb().select().from(works).where(eq(works.id,data.mediaId));
  for (const item of items) {
    const music=work?.category==='music'?await adapter.musicItem(connection.externalUserId!,item.id):null;
    const remote = music?{played:!!music.playCount,favourite:music.favourite,positionSeconds:music.positionSeconds??0}:(await adapter.item(connection.externalUserId!, item.id)).userData;
    if (remote) {
      const remoteEmpty=data.field==='watched'?!remote.played:data.field==='favourite'?!remote.favourite:!remote.positionSeconds;
      if(remoteEmpty){
        // Empty/default fields can be filled without interpreting an empty server as an import.
        await getDb().insert(syncValues).values({connectionId,mediaId:data.mediaId,category,remote:category==='progress'?{positionSeconds:0,durationSeconds:Math.round(data.durationSeconds??0)}:{value:false,...(music&&category==='history'?{playCount:0}:{})},agreed:desired})
          .onConflictDoUpdate({target:[syncValues.connectionId,syncValues.mediaId,syncValues.category],set:{conflict:false,agreed:desired}});
      }
      const decision = await reconcileProviderValue(
        userId,
        connectionId,
        data.mediaId,
        category,
        category === 'progress'
          ? {
              positionSeconds: Math.round(remote.positionSeconds * 1000) / 1000,
              durationSeconds: Math.round(data.durationSeconds ?? 0),
            }
          : { value: data.field === 'watched' ? remote.played : (remote.favourite ?? false),...(music&&category==='history'?{playCount:music.playCount??0}:{}) },
        { source: 'jellyfin',importRemote:connection.settings.importPlayback!==false }
      );
      if (decision === 'conflict' || decision === 'remote') return;
    }
    if (data.field === 'progress')
      await adapter.setProgress(connection.externalUserId!, item.id, Number(data.value));
    else if(music && data.field==='watched')await adapter.setListeningSummary(connection.externalUserId!,item.id,Number(desired.playCount));
    else if(music && data.field==='favourite')await adapter.setMusicFavourite(connection.externalUserId!,item.id,Boolean(data.value));
    else
      await adapter.setUserState(
        connection.externalUserId!,
        item.id,
        data.field,
        Boolean(data.value)
      );
  }
  await acknowledgeProviderValue(userId, connectionId, data.mediaId, category, desired);
  if(data.intentVersion)await getDb().delete(reconciliationIntents).where(and(eq(reconciliationIntents.connectionId,connectionId),eq(reconciliationIntents.workId,data.mediaId),eq(reconciliationIntents.category,category),eq(reconciliationIntents.version,data.intentVersion)));
}

export async function executeJellyfinScrobble(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      sessionId: v.pipe(v.string(), v.uuid()),
      event: v.picklist(['start', 'progress', 'stop']),
      positionSeconds: v.pipe(v.number(), v.minValue(0)),
      paused: v.optional(v.boolean()),
    }),
    input
  );
  const { playbackSessions } = await import('$lib/server/db/schema');
  const [session] = await getDb()
    .select()
    .from(playbackSessions)
    .where(
      and(
        eq(playbackSessions.id, data.sessionId),
        eq(playbackSessions.userId, userId),
        eq(playbackSessions.connectionId, connectionId)
      )
    );
  if (!session) return;
  const [item] = await getDb()
    .select()
    .from(providerItems)
    .where(eq(providerItems.id, session.providerItemId));
  if (!item) return;
  const { adapter } = await getJellyfin(userId, connectionId);
  await adapter.scrobble(data.event, {
    itemId: item.externalId,
    sourceId: session.sourceId,
    playSessionId: session.providerSessionId || undefined,
    positionSeconds: data.positionSeconds,
    paused: data.paused,
    method: session.delivery === 'direct' ? 'DirectPlay' : 'Transcode',
  });
}
