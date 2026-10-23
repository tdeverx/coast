import { getFeatureConfig } from '#lib/server/features.js';
import { featureValues, type FeatureConfiguration } from '#lib/features.js';
import { defaultConfig } from '#lib/server/config.js';
import {jellyfinItemKey} from '#lib/providers/jellyfin/paging.js';
import {importJellyfinReading} from './jellyfin-reading.server';
import { persistMusic, observeMusicPageAccess, recordImportedMusicListens } from '#lib/music/persistence.server.js';
import { reconcileJellyfinBatch } from './jellyfin-finalization.server';
import { enqueueInTransaction } from '#lib/sync/changes.server.js';
import {
  reconcileProviderValue,
  acknowledgeProviderValue,
  localSyncValue,
  sameValue,
} from '#lib/sync/values.server.js';
import { importJellyfinPlayback, seedEmptyJellyfinPlayback, unchangedJellyfinPlayback, type JellyfinPlaybackObservation } from '#lib/sync/jellyfin-playback.server.js';
import { jellyfinScanProgressSchema, type JellyfinScanProgress } from './jellyfin-progress';
import { jobCheckpoint, assertJobLease, JobYield, readJobCheckpoint, saveJobCheckpoint } from '#lib/server/queue/execution.js';
import { artworkKeys } from '#lib/artwork.js';
import * as v from 'valibot';
import { and, eq, isNull, ne, or, sql, desc, inArray, lte } from 'drizzle-orm';
import { getDb, type Database } from '#lib/server/db/index.js';
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
} from '#lib/server/db/schema.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { PermanentActionError } from '#lib/server/queue/index.js';
import { notify } from '#lib/server/notifications/index.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { ingestMetadata } from '#lib/catalogue/service.server.js';
import type { AvailableItem } from '#lib/providers/contracts.js';
import {captureScreenAccessProof,observeScreenLibraryPage,publishScreenLibraryCensus,sameScreenAccessProof,tryReuseScreenAccess,type ScreenAccessProof} from '#lib/providers/jellyfin/access-proof.server.js';

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

export async function libraryScanProgress(userId: string, connectionId: string, since?:Date, personal = false) {
  const { connection } = await getJellyfin(userId, connectionId);
  const [job] = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(
        eq(outboxActions.userId, userId),
        eq(outboxActions.connectionId, connectionId),
        eq(outboxActions.kind, personal ? 'jellyfin.bootstrap' : 'jellyfin.sync'),
        since ? sql`${outboxActions.createdAt} >= ${since}` : undefined
      )
    )
    .orderBy(desc(outboxActions.createdAt))
    .limit(1);
  if (!job) return null;
  const parsed = v.safeParse(jellyfinScanProgressSchema, personal ? connection.settings.initialSync : connection.settings.userSync);
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
            eq(syncCheckpoints.kind, personal ? 'jellyfin-personal' : 'jellyfin-user')
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
    stageProcessed: current?.stageProcessed ?? current?.processed ?? 0,
    stageTotal: current?.stageTotal === undefined ? current?.total ?? null : current.stageTotal,
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
  onStage?: (stage: string) => void,
  provided?: JellyfinSyncContext
) {
  return runJellyfinScan(userId, connectionId, 'library', full, onStage,provided);
}

export async function syncJellyfinUser(
  userId: string,
  connectionId: string,
  onStage?: (stage: string) => void,
  provided?: JellyfinSyncContext
) {
  return runJellyfinScan(userId, connectionId, 'user', true, onStage,provided);
}

/** Import only personal state before onboarding opens. Full availability follows at background priority. */
export async function bootstrapJellyfinUser(userId: string, connectionId: string,
  onStage?: (stage: string) => void, provided?: JellyfinSyncContext) {
  const [ready] = await getDb().execute(sql`select c.connection_id from sync_checkpoints c
    join provider_connections p on p.id=c.connection_id
    join users u on u.id=p.user_id and not u.disabled
    join provider_instances i on i.id=p.instance_id and i.enabled
    left join user_onboarding o on o.user_id=p.user_id and o.completed_at is null
    where p.id=${connectionId} and p.user_id=${userId} and p.status='connected'
      ${provided ? sql`and p.account_generation=${provided.connection.accountGeneration}::uuid` : sql``}
      and p.settings->'initialSync'->>'accountGeneration'=p.account_generation::text
      and c.kind='jellyfin-personal' and c.scan_id is null and c.completed_at is not null
      and (o.requested_at is null or c.completed_at>=o.requested_at)`);
  if (ready) return {checked: 0, count: 0, full: false};
  const context=await jellyfinContext(userId,connectionId,provided);
  onStage?.('cached-library-access');
  if((await getFeatureConfig(userId)).features.screen)await tryReuseScreenAccess(context);
  return runJellyfinScan(userId, connectionId, 'personal', true, onStage, context);
}

/** Incremental hints are re-read with this account's native permissions. They never
 * advance a full census cursor or establish whole-library coverage. */
export async function syncJellyfinChanges(userId:string,connectionId:string,scope:'library'|'user',
  ids:{video:string[];music:string[];reading?:string[]},provided?:JellyfinSyncContext){
  if(ids.video.length+ids.music.length+(ids.reading?.length??0)>200)throw new Error('Too many incremental Jellyfin items.');
  return runJellyfinScan(userId,connectionId,scope,true,undefined,provided,ids);
}

async function runJellyfinScan(
  userId: string,
  connectionId: string,
  scope: 'library' | 'user' | 'personal',
  full = true,
  onStage?: (stage: string) => void,
  provided?: JellyfinSyncContext,
  changes?: {video:string[];music:string[];reading?:string[]}
) {
  onStage?.('connection');
  const { adapter, connection, instance } = await jellyfinContext(userId, connectionId,provided);
  onStage?.('identity');
  await adapter.identity(instance.serverIdentity || undefined);
  onStage?.('checkpoint-read');
  const db = getDb(),
    kind = scope === 'personal' ? 'jellyfin-personal' : scope === 'user' ? 'jellyfin-user' : full ? 'jellyfin-full' : 'jellyfin-recent';
  const userScope = scope !== 'library';
  const featureConfig=userScope?await getFeatureConfig(userId):await getFeatureConfig(null);
  const signatureOf=(values:ReturnType<typeof featureValues>)=>['screen','music','book','comic'].map(key=>Number(values[key as keyof typeof values])).join('');
  const featureSignature=signatureOf(featureConfig.features);
  const progressKey = scope === 'personal' ? 'initialSync' : 'userSync';
  const filters = ['IsPlayed', 'IsResumable', 'IsFavorite'] as const;
  const filterPhases = ['watched', 'resume', 'favourites'] as const;
  let filterIndex = 0;
  const [checkpoint] = changes ? [] : await db
    .select()
    .from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
  let scanId = checkpoint?.scanId ?? crypto.randomUUID();
  const accessContext={adapter,connection,instance};
  let inventoryProof=featureConfig.features.screen&&!changes&&scope!=='personal'&&full?await captureScreenAccessProof(accessContext):null;
  let libraryIndex=0,libraryCompleted=0,libraryTotal:number|null=null;
  let offset = 0;
  if (checkpoint?.scanId && checkpoint.cursor) {
    if (scope === 'personal') {
      const cursor = v.parse(v.object({filter: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3)), offset: v.pipe(v.number(), v.integer(), v.minValue(0))}), JSON.parse(checkpoint.cursor));
      filterIndex = cursor.filter; offset = cursor.offset;
    } else if(checkpoint.cursor.startsWith('{')) {
      const cursor=v.parse(v.object({libraryIndex:v.pipe(v.number(),v.integer(),v.minValue(0)),offset:v.pipe(v.number(),v.integer(),v.minValue(0)),
        completed:v.pipe(v.number(),v.integer(),v.minValue(0)),total:v.nullable(v.pipe(v.number(),v.integer(),v.minValue(0))),proof:v.unknown()}),JSON.parse(checkpoint.cursor));
      if(!inventoryProof||!sameScreenAccessProof(cursor.proof as ScreenAccessProof,inventoryProof)) {
        await db.update(syncCheckpoints).set({cursor:null,scanId:null,completedAt:null,updatedAt:new Date()}).where(and(eq(syncCheckpoints.connectionId,connectionId),eq(syncCheckpoints.kind,kind)));
        throw new Error('Jellyfin library permissions changed during the census.');
      }
      libraryIndex=cursor.libraryIndex;libraryCompleted=cursor.completed;libraryTotal=cursor.total;offset=cursor.offset;
    } else {
      offset = Number(checkpoint.cursor);
      // Finish a pre-existing global traversal; the next full pass establishes per-library provenance.
      inventoryProof=null;
    }
  }
  if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
  const previousScan = instance.settings.libraryScan as Record<string, unknown> | undefined;
  const completedAt =
    checkpoint?.completedAt?.getTime() ??
    Math.max(
      Date.parse(String(previousScan?.fullCompletedAt ?? '')) || 0,
      Date.parse(String(previousScan?.recentCompletedAt ?? '')) || 0
    );
  const since = !full && completedAt ? new Date(completedAt - 60000).toISOString() : undefined;
  const parsedProgress = v.safeParse(jellyfinScanProgressSchema, changes ? undefined : scope === 'library' ? previousScan : connection.settings[progressKey]);
  const scanProgress = parsedProgress.success ? parsedProgress.output : undefined;
  const resetId=scope==='user'&&typeof connection.settings.userSyncResetId==='string'?connection.settings.userSyncResetId:undefined;
  const retainedStart=scanProgress?.featureSignature!==featureSignature||scope==='user'&&scanProgress?.resetId!==resetId?undefined:scanProgress?.startedAt;
  const startedAt = checkpoint?.scanId===scanProgress?.scanId && retainedStart && Number.isFinite(Date.parse(retainedStart)) ? retainedStart : new Date().toISOString();
  // If progress no longer belongs to this checkpoint, restart rather than skip changed pages.
  if(startedAt!==retainedStart){offset=0;filterIndex=0;libraryIndex=0;libraryCompleted=0;libraryTotal=null;if(checkpoint?.scanId)scanId=crypto.randomUUID();}
  const resume = checkpoint?.scanId === scanProgress?.scanId && startedAt === retainedStart &&
    (scope === 'library' || scanProgress?.accountGeneration === connection.accountGeneration) ? scanProgress : undefined;
  let phase: JellyfinScanProgress['phase'] = resume?.phase ?? (scope === 'personal' ? filterPhases[filterIndex] ?? 'reconciling' : 'scanning');
  // The durable cursor may commit just before the progress label. A finished
  // filter union must never resume as an unfiltered whole-library request.
  if (scope === 'personal' && filterIndex === filters.length && filterPhases.includes(phase as typeof filterPhases[number])) phase = 'reconciling';
  async function report(processed: number, total: number | null, nextPhase: JellyfinScanProgress['phase'] = 'scanning',
    details: Pick<JellyfinScanProgress, 'playbackCursor' | 'readingOffset' | 'musicOffset' | 'musicFilter' | 'musicPlaybackCursor' | 'traversalTotal' | 'stageProcessed' | 'stageTotal' | 'finalizationPhase' | 'finalizationCursor' | 'finalizationCategory'> = {}, store: Pick<Database,'update'> = db) {
    phase = nextPhase;
    const progress = { featureSignature, processed, total, phase, startedAt, scanId, accountGeneration: connection.accountGeneration, resetId, ...details };
    if (scope === 'library')
      await store
        .update(providerInstances)
        .set({
          settings: sql`jsonb_set(${providerInstances.settings}, '{libraryScan}', coalesce(${providerInstances.settings}->'libraryScan', '{}'::jsonb) || ${progress}::jsonb, true)`,
        })
        .where(eq(providerInstances.id, instance.id));
    else
      await store
        .update(providerConnections)
        .set({
          settings: sql`jsonb_set(${providerConnections.settings}, ARRAY[${progressKey}]::text[], ${progress}::jsonb, true)`,
        })
        .where(
          and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId), eq(providerConnections.accountGeneration, connection.accountGeneration))
        );
  }
  // Mark traversal before its first remote request. An interrupted first page
  // cannot leave earlier negative observations looking like current coverage.
  const screenCursor=(nextOffset:number)=>inventoryProof?JSON.stringify({libraryIndex,offset:nextOffset,completed:libraryCompleted,total:libraryTotal,proof:inventoryProof}):String(nextOffset);
  const initialCursor=scope === 'personal' ? JSON.stringify({filter:filterIndex,offset}) : screenCursor(offset);
  if(!changes)await db.transaction(async tx=>{
    await ensureConnected(tx,true);
    await tx.insert(syncCheckpoints).values({connectionId,kind,cursor:initialCursor,scanId,updatedAt:new Date()})
      .onConflictDoUpdate({target:[syncCheckpoints.connectionId,syncCheckpoints.kind],set:{cursor:initialCursor,scanId,updatedAt:new Date()}});
  });
  if (phase === 'complete') phase = scope === 'personal' ? 'watched' : 'scanning';
  if(!changes)await report(resume?.processed ?? offset, resume?.total ?? null, phase, {
    readingOffset:resume?.readingOffset, playbackCursor: resume?.playbackCursor, musicOffset: resume?.musicOffset, musicFilter: resume?.musicFilter,
    musicPlaybackCursor:resume?.musicPlaybackCursor, traversalTotal:resume?.traversalTotal,
    stageProcessed: resume?.stageProcessed, stageTotal: resume?.stageTotal,
    finalizationPhase:resume?.finalizationPhase,finalizationCursor:resume?.finalizationCursor,finalizationCategory:resume?.finalizationCategory,
  });
  const visited = new Map<string, string>();
  const hydratedItems = new Map<string, AvailableItem>();
  const missingItems = new Set<string>();
  const listedItems = new Set<string>();
  const knownItems = new Map<
    string,
    { providerItem: typeof providerItems.$inferSelect; saved: typeof media.$inferSelect }
  >();
  const pendingAvailability = new Map<string, typeof availability.$inferInsert>();
  const availableTitles = new Map<string, string>();
  const expectedMembers = new Map<string, number>();
  async function ensureConnected(store: Pick<Database, 'select'> = db, lock = false) {
    const query = store
      .select({ settings: providerConnections.settings, featureChoices:users.settings, featurePolicy:sql<FeatureConfiguration>`(select value from system_settings where key='coast')` })
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
    // Protect account/generation changes without blocking the FK key-share lock
    // of a concurrent intent/outbox insert. FOR UPDATE formed a lock cycle with
    // finalization waiting on that writer's intent row.
    const [current] = await (lock ? query.for('no key update', {of: providerConnections}) : query);
    if (!current) throw new PermanentActionError('The connected account changed during this task.');
    if(signatureOf(featureValues({...defaultConfig,...current.featurePolicy},userScope?current.featureChoices.features:undefined))!==featureSignature)throw new JobYield();
    if(scope==='user'&&!changes&&current.settings.userSyncResetId!==resetId)throw new JobYield();
    await assertJobLease(store,lock);
    return current;
  }
  let importPlayback = connection.settings.importPlayback !== false;
  const importItem = async (item: AvailableItem, ancestry = new Set<string>()): Promise<string | null> => {
    if (missingItems.has(item.id)) return null;
    if (visited.has(item.id)) return visited.get(item.id)!;
    if (ancestry.has(item.id)) throw new Error('Jellyfin returned a cyclic media hierarchy.');
    ancestry.add(item.id);
    const [known] = knownItems.has(item.id)
      ? [knownItems.get(item.id)!]
      : userScope
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
    if (userScope && !known) {
      const detail = hydratedItems.get(item.id) ?? await adapter.itemIfAvailable(connection.externalUserId!, item.id);
      if (!detail) return null;
      item = detail;
    }
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
      const parentItem = parent?.mediaId ? null : hydratedItems.get(item.showId) ?? await adapter.itemIfAvailable(connection.externalUserId!, item.showId);
      const resolvedShow = parent?.mediaId || (parentItem ? await importItem(parentItem, ancestry) : null);
      if (!resolvedShow) return null;
      showId = resolvedShow;
      if (item.kind === 'episode') {
        const [existing] = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, item.seasonNumber ?? 0)));
        if (existing) seasonId = existing.mediaId;
        else if (item.parentId) {
          const parentItem = hydratedItems.get(item.parentId) ?? await adapter.itemIfAvailable(connection.externalUserId!, item.parentId);
          const resolvedSeason = parentItem ? await importItem(parentItem, ancestry) : null;
          if (!resolvedSeason) return null;
          seasonId = resolvedSeason;
        }
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
            set: { mediaId: saved.id, snapshot: sql`${item.metadata}::jsonb || case when ${item.access?.locationType==='FileSystem'&&(item.access?.sourceType==null||item.access.sourceType==='Library')} and ${providerItems.snapshot}->'screenAccess' is not null then jsonb_build_object('screenAccess',${providerItems.snapshot}->'screenAccess') else '{}'::jsonb end`, lastSeenAt: new Date() },
          })
          .returning();
    if (scope === 'library' && item.expectedMembers !== undefined) expectedMembers.set(providerItem.id, item.expectedMembers);
    if (scope === 'library') return saved.id;
    availableTitles.set(saved.id, saved.title);
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
        source: { ...source.raw, ...(userScope ? {coastUserData:item.userData??null,coastMembershipCount:item.expectedMembers??null,coastReadStage:scope==='personal'?String(filterIndex):'user',coastListed:listedItems.has(item.id)} : {}) },
        state: 'available' as const,
        verifiedAt: new Date(),
        scanId,
      };
      pendingAvailability.set(`${providerItem.id}:${source.id}`, data);
    }

    return saved.id;
  };
  async function flushPage() {
    const ids = [...availableTitles.keys()];
    // Access is granted only for items returned by this user's authenticated page.
    // Keep editions distinct, and deduplicate repeated source IDs before the upsert.
    const previous = ids.length ? await db.select({id: availability.mediaId}).from(availability)
      .where(and(eq(availability.userId, userId), inArray(availability.mediaId, ids), eq(availability.state, 'available'))) : [];
    const previouslyAvailable = new Set(previous.map(row => row.id));
    const rows = [...pendingAvailability.values()];
    await db.transaction(async tx => {
    await ensureConnected(tx, true);
    for (let index = 0; index < rows.length; index += 500) {
      await tx.insert(availability).values(rows.slice(index, index + 500)).onConflictDoUpdate({
        target: [availability.userId, availability.connectionId, availability.providerItemId, availability.sourceId],
        set: {
          mediaId: sql`excluded.media_id`, edition: sql`excluded.edition`, container: sql`excluded.container`,
          videoCodec: sql`excluded.video_codec`, audioCodec: sql`excluded.audio_codec`, bitrate: sql`excluded.bitrate`,
          width: sql`excluded.width`, height: sql`excluded.height`, durationSeconds: sql`excluded.duration_seconds`,
          source: sql`excluded.source`, state: 'available', verifiedAt: sql`excluded.verified_at`, scanId: sql`excluded.scan_id`,
        },
      });
    }
    if (expectedMembers.size) await tx.execute(sql`
      update provider_items pi set snapshot=pi.snapshot || jsonb_build_object('expectedMembers',counts.total,'membershipEvidence',jsonb_build_object('connectionId',${connectionId}::text,'accountGeneration',${connection.accountGeneration}::text,'scope','user-visible','observedAt',${startedAt}::text))
      from (values ${sql.join([...expectedMembers].map(([id, count]) => sql`(${id}::uuid,${count}::integer)`), sql`,`)}) as counts(id,total)
      where pi.id=counts.id and pi.instance_id=${instance.id}`);
    });
    const newlyAvailable = ids.filter(id => !previouslyAvailable.has(id));
    const savedTitles = newlyAvailable.length ? await db.select({id: trackingState.mediaId}).from(trackingState)
      .where(and(eq(trackingState.userId, userId), inArray(trackingState.mediaId, newlyAvailable), eq(trackingState.watchlist, true))) : [];
    for (const {id} of savedTitles) await notify({
      userId, kind: 'availability', title: `${availableTitles.get(id)} is available`,
      body: 'A title on your watchlist is now in your library.', sourceKey: `available:${id}`,
      data: {actorId: userId, subjectId: id, workId: id, destination: `/media/${id}`},
    });
    pendingAvailability.clear(); availableTitles.clear(); expectedMembers.clear();
  }
  async function importMusic(saved:{workId:string},item:{id:string;kind:'album'|'track';favourite?:boolean;playCount:number;positionSeconds:number;durationSeconds:number}) {
    if(userScope && saved.workId && importPlayback){
          if(item.favourite!==undefined)await reconcileProviderValue(userId,connectionId,saved.workId,'favourite',{value:item.favourite},{source:'jellyfin',accountGeneration:connection.accountGeneration});
          if(item.kind==='track'){
            const count=Math.max(0,Math.min(item.playCount??0,10000));
            await reconcileProviderValue(userId,connectionId,saved.workId,'history',{value:count>0,playCount:count},{source:'jellyfin',accountGeneration:connection.accountGeneration,apply:async tx=>{
              let added=0;
              const [baseline]=await tx.select().from(syncValues).where(and(eq(syncValues.connectionId,connectionId),eq(syncValues.mediaId,saved.workId!),eq(syncValues.category,'history')));
              const local=await localSyncValue(tx,userId,saved.workId!,'history');
              const observed=Number(baseline?.remote.playCount??local.playCount??0);
              added=await recordImportedMusicListens(tx,userId,saved.workId!,connection.syncAccountId??connectionId,Math.min(count,observed),count);
              await tx.insert(musicProgress).values({userId,trackId:saved.workId!,playCount:count}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:count,updatedAt:new Date()}});
              return {changed:added>0};
            }});
            await reconcileProviderValue(userId,connectionId,saved.workId,'progress',{positionSeconds:Math.round((item.positionSeconds??0)*1000)/1000,durationSeconds:Math.round(item.durationSeconds??0)},{source:'jellyfin',accountGeneration:connection.accountGeneration});
          }
        }
  }
  // Like screen copies, accessible recordings/releases contribute one account
  // observation: favourite OR, maximum reported count, furthest resume position.
  async function reconcileMusicObservations(ids?:string[],after?:string|null){
    const observed=v.parse(v.array(v.object({id:v.pipe(v.string(),v.uuid()),kind:v.picklist(['album','track']),favourite:v.nullable(v.boolean()),
      playCount:v.number(),positionSeconds:v.number(),durationSeconds:v.number()})),await db.execute(sql`
      select a.media_id as id,w.kind,bool_or((a.source->'coastMusicData'->>'favourite')::boolean) as favourite,
        max((a.source->'coastMusicData'->>'playCount')::integer) as "playCount",
        max((a.source->'coastMusicData'->>'positionSeconds')::double precision) as "positionSeconds",
        coalesce(max(a.duration_seconds),0) as "durationSeconds"
      from availability a join works w on w.id=a.media_id
      where a.connection_id=${connectionId} and a.state='available' and w.kind in ('album','track')
        and a.source->>'coastMusicGeneration'=${connection.accountGeneration}
        and jsonb_typeof(a.source->'coastMusicData')='object'
        ${ids?sql`and a.media_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`:sql`and (a.scan_id=${scanId}::uuid or a.verified_at>${startedAt}::timestamptz)`}
        ${after?sql`and a.media_id>${after}::uuid`:sql``}
      group by a.media_id,w.kind order by a.media_id limit 100`));
    for(const row of observed){
      if((await ensureConnected()).settings.importPlayback===false)break;
      await importMusic({workId:row.id},{...row,id:row.id,favourite:row.favourite??undefined});
    }
    return observed;
  }
  async function validateStagePage(stage:string,page:{items:{id:string}[];total:number},at:number,expected:number|null){
    let changed=at>0&&(expected===null||page.total!==expected);
    if(!changed&&userScope&&at>0&&page.items.length){
      const repeated=await db.execute(sql`select a.id from availability a join provider_items pi on pi.id=a.provider_item_id
        where a.connection_id=${connectionId} and a.scan_id=${scanId}::uuid
        and replace(lower(pi.external_id),'-','') in (${sql.join(page.items.map(item=>sql`${jellyfinItemKey(item.id)}`),sql`,`)})
        and (${stage}='reading' or a.source->>'coastReadStage'=${stage}) limit 1`);
      changed=repeated.length>0;
    }
    if(changed){
      await db.transaction(async tx=>{
        await ensureConnected(tx,true);
        await tx.update(syncCheckpoints).set({cursor:null,scanId:null,completedAt:null,updatedAt:new Date()}).where(and(eq(syncCheckpoints.connectionId,connectionId),eq(syncCheckpoints.kind,kind)));
      });
      throw new Error('Jellyfin library changed during pagination.');
    }
  }
  if(changes){
    const items=featureConfig.features.screen?await adapter.items(connection.externalUserId!,changes.video):[];
    for(const item of items)hydratedItems.set(item.id,item);
    for(const item of items)await importItem(item);
    const touched=[...visited.values()];
    const changedWorks=new Set(touched);
    const currentSources=[...pendingAvailability.values()];
    await flushPage();
    if(userScope&&currentSources.length)await db.transaction(async tx=>{
      await ensureConnected(tx,true);
      await tx.execute(sql`update availability a set state='unavailable',verified_at=now()
        where a.connection_id=${connectionId} and a.provider_item_id in (${sql.join([...new Set(currentSources.map(row=>row.providerItemId))].map(id=>sql`${id}::uuid`),sql`,`)})
        and not exists(select 1 from (values ${sql.join(currentSources.map(row=>sql`(${row.providerItemId}::uuid,${row.sourceId}::text)`),sql`,`)}) as present(item_id,source_id)
          where present.item_id=a.provider_item_id and present.source_id=a.source_id)`);
    });
    importPlayback=(await ensureConnected()).settings.importPlayback!==false;
    if(userScope && featureConfig.features.screen && changes.video.length){
      // A complete IDs lookup can confirm loss only for its requested IDs, not other titles.
      const missing=changes.video.filter(id=>!hydratedItems.has(id));
      if(missing.length)await db.transaction(async tx=>{
        await ensureConnected(tx,true);
        await tx.execute(sql`update availability a set state='unavailable',verified_at=now()
          from provider_items pi where a.provider_item_id=pi.id and pi.instance_id=${instance.id}
          and pi.external_id in (${sql.join(missing.map(id=>sql`${id}`),sql`,`)}) and a.connection_id=${connectionId}`);
      });
      if(importPlayback && touched.length){
        const observed=await db.execute<JellyfinPlaybackObservation>(sql`
          select a.media_id as id,m.kind,bool_or((a.source->'coastUserData'->>'played')::boolean) as played,
            bool_or((a.source->'coastUserData'->>'favourite')::boolean) as favourite,
            coalesce((array_agg((a.source->'coastUserData'->>'positionSeconds')::double precision order by
              case when (a.source->'coastUserData'->>'positionSeconds')::double precision>0 then 1 else 0 end desc,
              a.source->'coastUserData'->>'lastPlayedAt' desc nulls last,a.verified_at desc,a.provider_item_id))[1],0) as position,
            max((a.source->'coastUserData'->>'playCount')::integer) as "playCount",
            max(a.source->'coastUserData'->>'lastPlayedAt') as "lastPlayedAt",max(a.duration_seconds) as duration
          from availability a join media m on m.id=a.media_id where a.connection_id=${connectionId} and a.state='available'
          and a.media_id in (${sql.join(touched.map(id=>sql`${id}::uuid`),sql`,`)})
          and jsonb_typeof(a.source->'coastUserData')='object' group by a.media_id,m.kind`);
        for(const row of observed){
          if((await ensureConnected()).settings.importPlayback===false)break;
          await importJellyfinPlayback(userId,connectionId,row.id,{kind:row.kind,metadata:{},sources:row.duration===null?[]:[{durationSeconds:row.duration}],
            userData:{played:row.played,favourite:row.favourite??undefined,positionSeconds:row.position,playCount:row.playCount,lastPlayedAt:row.lastPlayedAt??undefined}},connection.accountGeneration);
        }
      }
    }
    if(changes.music.length && featureConfig.experimentalMusic){
      const previous=await db.select({id:providerItems.mediaId}).from(providerItems).where(and(eq(providerItems.instanceId,instance.id),
        sql`replace(lower(${providerItems.externalId}),'-','') in (${sql.join(changes.music.map(id=>sql`${jellyfinItemKey(id)}`),sql`,`)})`));
      const musicWorks=new Set(previous.map(row=>row.id));
      const remote=await adapter.musicItems(connection.externalUserId!,changes.music);
      const saved=userScope?await observeMusicPageAccess(userId,connectionId,instance.id,connection.accountGeneration,remote,scanId):await Promise.all(remote.map(item=>persistMusic(instance.id,item)));
      for(const item of saved)if(item.workId){changedWorks.add(item.workId);musicWorks.add(item.workId);}
      if(userScope){
        const present=new Set(remote.map(item=>jellyfinItemKey(item.id)));
        const missing=changes.music.filter(id=>!present.has(jellyfinItemKey(id)));
        if(missing.length)await db.transaction(async tx=>{await ensureConnected(tx,true);
          await tx.execute(sql`update availability a set state='unavailable',verified_at=now() from provider_items pi
            where a.provider_item_id=pi.id and pi.instance_id=${instance.id} and replace(lower(pi.external_id),'-','') in (${sql.join(missing.map(id=>sql`${jellyfinItemKey(id)}`),sql`,`)}) and a.connection_id=${connectionId}`);
        });
        for(const id of musicWorks)changedWorks.add(id);
        if(importPlayback&&musicWorks.size){
          let after:string|null=null;
          for(;;){const observed=await reconcileMusicObservations([...musicWorks],after);after=observed.at(-1)?.id??after;if(observed.length<100)break;}
        }
      }
    }
    if(userScope)await db.transaction(async tx=>{
      const current=await ensureConnected(tx,true);
      if(current.settings.reconcileTracking===true && changedWorks.size){
        const intents=await tx.select().from(reconciliationIntents).where(and(eq(reconciliationIntents.connectionId,connectionId),inArray(reconciliationIntents.workId,[...changedWorks])));
        for(const intent of intents)await enqueueInTransaction(tx,{userId,connectionId,kind:'jellyfin.reconcile',payload:{mediaId:intent.workId,field:intent.category==='history'?'watched':intent.category,value:intent.category==='progress'?Number(intent.value.positionSeconds):Boolean(intent.value.value),playCount:intent.value.playCount,durationSeconds:intent.value.durationSeconds,intentVersion:intent.version,backfill:true},compactionKey:`jellyfin-reconcile:${intent.workId}:${intent.category}`});
      }
      await (await import('#lib/sync/changes.server.js')).enqueueCollectionProjectionInTransaction(tx,userId);
    });
    let deferred=0;
    if(featureConfig.experimentalBooks||featureConfig.experimentalComics)for(const id of changes.reading??[]){
      let book;
      try{book=await adapter.readingItem(connection.externalUserId!,id);}
      catch(cause){
        if(!(cause instanceof ProviderHttpError)||![404,410].includes(cause.status))throw cause;
        // A missing individual file is an authoritative negative only for this
        // authenticated account. It cannot withdraw other users' sources.
        if(userScope)await db.transaction(async tx=>{
          await ensureConnected(tx,true);
          await tx.execute(sql`update availability a set state='unavailable',verified_at=now()
            from provider_items pi join reading_works r on r.id=pi.media_id
            where a.provider_item_id=pi.id and pi.instance_id=${instance.id} and a.connection_id=${connectionId}
              and replace(lower(pi.external_id),'-','')=${jellyfinItemKey(id)}`);
        });
        deferred++;
        continue;
      }
      await importJellyfinReading({adapter,connection,instance},[book],{access:userScope,scanId});
    }
    return {checked:items.length+changes.music.length+(changes.reading?.length??0),count:touched.length,full:false,deferred};
  }
  // Publish positive reading access before unrelated playback reconciliation.
  // Keep its finite cursor in this job; the original multi-medium census/negative
  // publication still completes under the existing scan/reset/generation fence.
  if(scope!=='personal'&&(featureConfig.experimentalBooks||featureConfig.experimentalComics)){
    const saved=await readJobCheckpoint();
    const point=v.safeParse(v.object({task:v.literal('jellyfin-reading-access'),scanId:v.pipe(v.string(),v.uuid()),
      offset:v.pipe(v.number(),v.integer(),v.minValue(0)),total:v.nullable(v.pipe(v.number(),v.integer(),v.minValue(0))),done:v.boolean()}),saved);
    let access=point.success&&point.output.scanId===scanId?point.output:{task:'jellyfin-reading-access' as const,scanId,offset:0,total:null as number|null,done:false};
    await saveJobCheckpoint(access);
    while(!access.done){
      await ensureConnected();
      const page=await adapter.readingPage(connection.externalUserId!,access.offset);
      await validateStagePage('reading',{items:page.items.map(item=>({id:item.Id})),total:page.total},access.offset,access.total);
      const start=access.offset;
      await importJellyfinReading({adapter,connection,instance},page.items,{access:scope==='user',scanId,
        expectedResetId:scope==='user'?resetId??null:undefined,checkpoint:async count=>{
          access={...access,offset:start+count,total:page.total};
          await saveJobCheckpoint(access);
          await jobCheckpoint();
        }});
      access={...access,offset:page.nextOffset??start+page.items.length,total:page.total,done:page.nextOffset===null};
      await saveJobCheckpoint(access);
      await jobCheckpoint();
    }
  }
  let count = 0,
    processed = resume?.processed ?? offset,
    total: number | null = resume?.total ?? null;
  while (featureConfig.features.screen && (phase === 'scanning' || phase === 'watched' || phase === 'resume' || phase === 'favourites')) {
    if(inventoryProof&&libraryIndex>=inventoryProof.libraryIds.length){processed=libraryCompleted;total=libraryCompleted;await report(processed,total,'reconciling');break;}
    onStage?.('library-page');
    const current = await ensureConnected();
    importPlayback = !!current && current.settings.importPlayback !== false;
    const page = scope === 'personal' && !importPlayback ? {items: [], total: 0, nextOffset: null} :
      await adapter.library(connection.externalUserId!, offset, since, userScope ? 'user' : 'library', scope === 'personal' ? filters[filterIndex] : undefined,inventoryProof?.libraryIds[libraryIndex]);
    await ensureConnected();
    if(offset>0 && (inventoryProof?libraryTotal:total)!==null && page.total!==(inventoryProof?libraryTotal:total)){
      await db.update(syncCheckpoints).set({cursor:null,scanId:null,completedAt:null,updatedAt:new Date()}).where(and(eq(syncCheckpoints.connectionId,connectionId),eq(syncCheckpoints.kind,kind)));
      throw new Error('Jellyfin library changed during pagination.');
    }
    if(userScope && offset>0 && page.items.length){
      const repeated=await db.select({id:availability.id}).from(availability).innerJoin(providerItems,eq(providerItems.id,availability.providerItemId))
        .where(and(eq(availability.connectionId,connectionId),eq(availability.scanId,scanId),inArray(providerItems.externalId,page.items.map(item=>item.id)),
          sql`${availability.source}->>'coastListed'='true'`,sql`${availability.source}->>'coastReadStage'=${scope==='personal'?String(filterIndex):'user'}`)).limit(1);
      if(repeated.length){
        await db.update(syncCheckpoints).set({cursor:null,scanId:null,completedAt:null,updatedAt:new Date()}).where(and(eq(syncCheckpoints.connectionId,connectionId),eq(syncCheckpoints.kind,kind)));
        throw new Error('Jellyfin library changed during pagination.');
      }
    }
    listedItems.clear();
    for(const item of page.items)listedItems.add(item.id);
    visited.clear();
    knownItems.clear();
    hydratedItems.clear();
    missingItems.clear();
    if (userScope && featureConfig.features.screen && page.items.length) {
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
      const missing = page.items.filter(item => !knownItems.has(item.id));
      if (missing.length) {
        const details = await adapter.items(connection.externalUserId!, [...new Set(missing.map(item=>item.id))]);
        for (const item of details) hydratedItems.set(item.id,item);
        for (const item of missing) if(!hydratedItems.has(item.id))missingItems.add(item.id);
        const ancestorIds = [...new Set(details.flatMap(item => [item.showId,item.parentId].filter((id):id is string=>!!id)))];
        if (ancestorIds.length) {
          const existing = await db.select({id:providerItems.externalId}).from(providerItems).where(and(eq(providerItems.instanceId,instance.id),inArray(providerItems.externalId,ancestorIds)));
          const knownParents = new Set(existing.map(item=>item.id));
          const unknown = ancestorIds.filter(id=>!knownParents.has(id)&&!hydratedItems.has(id));
          if(unknown.length)for(const item of await adapter.items(connection.externalUserId!,unknown))hydratedItems.set(item.id,item);
        }
      }
    }
    total = page.total;
    await report(offset, page.total, scope === 'personal' ? filterPhases[filterIndex] : 'scanning');
    onStage?.('item-import');
    for (const [index, item] of page.items.entries()) {
      await importItem(item);
      count++;
      if ((index + 1) % 25 === 0 || index === page.items.length - 1)
        await report(offset + index + 1, page.total, scope === 'personal' ? filterPhases[filterIndex] : 'scanning');
    }
    await flushPage();
    if(inventoryProof) {
      try {await observeScreenLibraryPage(accessContext,inventoryProof,inventoryProof.libraryIds[libraryIndex],scanId,page.items,offset);}
      catch(error) {
        await db.update(syncCheckpoints).set({cursor:null,scanId:null,completedAt:null,updatedAt:new Date()}).where(and(eq(syncCheckpoints.connectionId,connectionId),eq(syncCheckpoints.kind,kind)));
        throw error;
      }
      libraryTotal=page.total;
    }
    const nextFilter = scope === 'personal' && page.nextOffset === null ? filterIndex + 1 : filterIndex;
    const nextOffset = scope === 'personal' && page.nextOffset === null ? 0 : page.nextOffset ?? offset + page.items.length;
    if(inventoryProof&&page.nextOffset===null) {
      try {await publishScreenLibraryCensus(accessContext,inventoryProof,inventoryProof.libraryIds[libraryIndex],scanId,page.total);}
      catch(error) {
        await db.update(syncCheckpoints).set({cursor:null,scanId:null,completedAt:null,updatedAt:new Date()}).where(and(eq(syncCheckpoints.connectionId,connectionId),eq(syncCheckpoints.kind,kind)));
        throw error;
      }
      libraryCompleted+=page.total;libraryIndex++;libraryTotal=null;
    }
    const cursor = scope === 'personal' ? JSON.stringify({filter: nextFilter, offset: nextOffset}) : screenCursor(inventoryProof&&page.nextOffset===null?0:nextOffset);
    onStage?.('checkpoint-write');
    await db
      .insert(syncCheckpoints)
      .values({
        connectionId,
        kind,
        cursor,
        scanId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [syncCheckpoints.connectionId, syncCheckpoints.kind],
        set: {
          cursor,
          scanId,
          updatedAt: new Date(),
        },
      });
    if (scope === 'personal' && nextFilter < filters.length && page.nextOffset === null) {
      filterIndex = nextFilter; offset = 0;
      await report(0, null, filterPhases[filterIndex]);
      await jobCheckpoint();
      continue;
    }
    if (page.nextOffset === null) {
      if(inventoryProof&&libraryIndex<inventoryProof.libraryIds.length){offset=0;total=null;await report(0,null,'scanning');await jobCheckpoint();continue;}
      processed = inventoryProof?libraryCompleted:offset + page.items.length;
      if(inventoryProof)total=libraryCompleted;
      await report(processed, page.total, 'reconciling');
      await jobCheckpoint();
      break;
    }
    offset = page.nextOffset;
    await jobCheckpoint();
  }
  // Multiple accessible editions may disagree. Apply one account-level observation
  // per canonical title after a complete traversal; persisted access snapshots also
  // survive checkpoints/retries without retaining the entire catalogue in memory.
  if(userScope && featureConfig.features.screen && phase === 'reconciling' && (await ensureConnected()).settings.importPlayback!==false) {
    let after: string | null = resume?.phase === 'reconciling' ? resume.playbackCursor ?? null : null;
    const [size] = await db.execute<{total: number}>(sql`select count(distinct media_id)::integer as total from availability
      where user_id=${userId} and connection_id=${connectionId} and scan_id=${scanId} and state='available'
      and jsonb_typeof(source->'coastUserData')='object'`);
    let reconciled = resume?.phase === 'reconciling' ? resume.stageProcessed ?? 0 : 0;
    await report(processed, total, 'reconciling', {playbackCursor: after, stageProcessed: reconciled, stageTotal: size.total});
    observationPages: for (;;) {
    const observed: JellyfinPlaybackObservation[]=await db.execute<JellyfinPlaybackObservation>(sql`
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
        ${after === null ? sql`` : sql`and a.media_id > ${after}::uuid`}
      group by a.media_id,m.kind order by a.media_id limit 100`) as JellyfinPlaybackObservation[];
    if ((await ensureConnected()).settings.importPlayback === false) break observationPages;
    const unchanged = await unchangedJellyfinPlayback(userId, connectionId, connection.accountGeneration, observed);
    const untouched = await seedEmptyJellyfinPlayback(userId, connectionId, connection.accountGeneration, observed);
    for(const row of observed) {
      if (untouched.has(row.id) || unchanged.has(row.id)) continue;
      if ((await ensureConnected()).settings.importPlayback === false) break observationPages;
      await importJellyfinPlayback(userId,connectionId,row.id,{
        kind:row.kind,metadata:{},sources:row.duration===null?[]:[{durationSeconds:row.duration}],
        userData:{played:row.played,favourite:row.favourite??undefined,positionSeconds:row.position,playCount:row.playCount,lastPlayedAt:row.lastPlayedAt??undefined},
      },connection.accountGeneration);
    }
    reconciled += observed.length;
    after = observed.at(-1)?.id ?? after;
    await report(processed, total, 'reconciling', {playbackCursor: after, stageProcessed: reconciled, stageTotal: size.total});
    if (observed.length) await jobCheckpoint();
    if (observed.length < 100) break;
    }
  }
  // Metadata and per-user access remain separate for music, within the same service task.
  if(!featureConfig.features.screen&&['scanning','watched','resume','favourites'].includes(phase))await report(processed,total,'reconciling');
  if (phase === 'reconciling') await report(processed, total, 'music-albums', {musicOffset: 0, stageProcessed: 0, stageTotal: null});
  for(const musicKind of featureConfig.experimentalMusic?['album','track'] as const:[]){
    const musicPhase = musicKind === 'album' ? 'music-albums' : 'music-tracks';
    if (phase === 'music-reconciling' || phase === 'reading' || phase === 'finalizing' || phase === 'music-tracks' && musicKind === 'album') continue;
    let musicOffset = resume?.phase === musicPhase ? resume.musicOffset ?? 0 : 0;
    const musicFilters = scope === 'personal' ? musicKind === 'album' ? ['IsFavorite'] as const : filters : [undefined];
    let musicFilter = resume?.phase === musicPhase ? resume.musicFilter ?? 0 : 0;
    let traversalTotal=resume?.phase===musicPhase?resume.traversalTotal??null:null;
    await report(processed, total, musicPhase, {musicOffset, musicFilter, traversalTotal, stageProcessed: musicOffset, stageTotal: traversalTotal});
    for(;;){
      importPlayback=(await ensureConnected()).settings.importPlayback!==false;
      if (scope === 'personal' && !importPlayback || musicFilter >= musicFilters.length) break;
      const page=await adapter.musicLibrary(connection.externalUserId!,{kind:musicKind,offset:musicOffset,limit:100,filter:musicFilters[musicFilter]}, {scope:userScope?'user':'library',since:scope==='library'?since:undefined});
      await ensureConnected();
      const readStage=`${musicKind}:${musicFilter}`;
      await validateStagePage(readStage,page,musicOffset,traversalTotal);
      traversalTotal=page.total;
      const musicItems = userScope ? await observeMusicPageAccess(userId, connectionId, instance.id, connection.accountGeneration, page.items, scanId, ids=>adapter.musicItems(connection.externalUserId!,ids),readStage,scope==='user'?resetId??null:undefined) : page.items;
      if(!userScope)for(const item of musicItems)await persistMusic(instance.id,item);
      musicOffset = page.nextOffset ?? musicOffset + page.items.length;
      await report(processed, total, musicPhase, {musicOffset, musicFilter, traversalTotal, stageProcessed: musicOffset, stageTotal: page.total});
      if(page.nextOffset===null){
        musicFilter++; musicOffset=0;traversalTotal=null;
        await report(processed, total, musicPhase, {musicOffset, musicFilter, traversalTotal, stageProcessed: 0, stageTotal: null});
        if (musicFilter >= musicFilters.length) break;
      }
      await jobCheckpoint();
    }
    await report(processed, total, musicKind === 'album' ? 'music-tracks' : 'music-reconciling', {musicOffset: 0, stageProcessed: 0, stageTotal: null});
    await jobCheckpoint();
  }
  if(phase==='music-reconciling'){
    let after=resume?.phase==='music-reconciling'?resume.musicPlaybackCursor??null:null;
    if(userScope&&featureConfig.experimentalMusic&&(await ensureConnected()).settings.importPlayback!==false){
      for(;;){
        const observed=await reconcileMusicObservations(undefined,after);
        after=observed.at(-1)?.id??after;
        await report(processed,total,'music-reconciling',{musicPlaybackCursor:after});
        if(observed.length)await jobCheckpoint();
        if(observed.length<100)break;
      }
    }
    await report(processed,total,'reading',{readingOffset:0,traversalTotal:null});
  }
  // Reading positives were already checked by the independently retained prepass.
  let finalizationPhase=resume?.finalizationPhase??'screen',finalizationCursor=resume?.finalizationCursor??null,finalizationCategory=resume?.finalizationCategory??null;
  let finalizationProcessed=resume?.phase==='finalizing'?resume.stageProcessed??0:0;
  await report(processed, total, 'finalizing', {stageProcessed:finalizationProcessed,stageTotal:null,finalizationPhase,finalizationCursor,finalizationCategory});
  // Counts are scoped to the authenticated source account, never server-wide.
  // Restrict recomputation to parents touched by this metadata pass or its children.
  if (scope === 'library') await db.execute(sql`update provider_items parent set snapshot=parent.snapshot || jsonb_build_object('membershipComplete',
    (parent.snapshot->>'expectedMembers')::integer=(select count(distinct child.media_id) from provider_items child
      join episodes e on e.media_id=child.media_id where child.instance_id=parent.instance_id
      and (parent.kind='show' and e.show_id=parent.media_id or parent.kind='season' and e.season_id=parent.media_id)))
    where parent.instance_id=${instance.id} and parent.kind in ('show','season')
      and parent.snapshot->'membershipEvidence'->>'connectionId'=${connectionId}
      and parent.snapshot->'membershipEvidence'->>'accountGeneration'=${connection.accountGeneration}
      and parent.snapshot->>'expectedMembers' is not null
      and (parent.last_seen_at>=${startedAt}::timestamptz or exists(select 1 from provider_items child join episodes e on e.media_id=child.media_id
        where child.instance_id=parent.instance_id and child.last_seen_at>=${startedAt}::timestamptz
        and (parent.kind='show' and e.show_id=parent.media_id or parent.kind='season' and e.season_id=parent.media_id)))`);
  if(scope === 'user' && featureConfig.features.screen && (await ensureConnected()).settings.reconcileTracking===true){
    while(finalizationPhase!=='done'){
      await db.transaction(async tx=>{
        const current=await ensureConnected(tx,true);
        if(current.settings.reconcileTracking!==true){finalizationPhase='done';finalizationCursor=null;finalizationCategory=null;}
        else {
          const cursor=await reconcileJellyfinBatch(tx,userId,connectionId,scanId,{phase:finalizationPhase,workId:finalizationCursor,category:finalizationCategory,processed:finalizationProcessed});
          finalizationPhase=cursor.phase;finalizationCursor=cursor.workId;finalizationCategory=cursor.category;finalizationProcessed=cursor.processed;
        }
        await report(processed,total,'finalizing',{stageProcessed:finalizationProcessed,stageTotal:null,finalizationPhase,finalizationCursor,finalizationCategory},tx);
      });
      await jobCheckpoint();
    }
  }
  onStage?.('reconcile');
  await ensureConnected();
  await db.transaction(async (tx) => {
    await ensureConnected(tx, true);
    if (scope === 'user')
      await tx
        .update(availability)
        .set({ state: 'unavailable', verifiedAt: new Date() })
        .where(
          and(
            eq(availability.userId, userId),
            eq(availability.connectionId, connectionId),
            sql`exists(select 1 from works w where w.id=${availability.mediaId} and ((w.category='screen' and ${featureConfig.features.screen}) or (w.category='music' and ${featureConfig.features.music}) or (w.category='book' and ${featureConfig.features.book}) or (w.category='comic' and ${featureConfig.features.comic})))`,
            lte(availability.verifiedAt,new Date(startedAt)),
            or(ne(availability.scanId, scanId), isNull(availability.scanId))
          )
        );
    await tx
      .update(syncCheckpoints)
      .set({ cursor: null, scanId: null, completedAt: new Date(startedAt), updatedAt: new Date() })
      .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
    if(userScope){const {enqueueCollectionProjectionInTransaction}=await import('#lib/sync/changes.server.js');await enqueueCollectionProjectionInTransaction(tx,userId);}
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
  return { count, full, checked: processed, deferred:0 };
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
  const { playbackSessions } = await import('#lib/server/db/schema.js');
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
  const { adapter, connection } = await getJellyfin(userId, connectionId);
  if(session.accountGeneration!==connection.accountGeneration || session.shareId)return;
  await adapter.scrobble(data.event, {
    itemId: item.externalId,
    sourceId: session.sourceId,
    playSessionId: session.providerSessionId || undefined,
    positionSeconds: data.positionSeconds,
    paused: data.paused,
    method: session.delivery === 'direct' ? 'DirectPlay' : 'Transcode',
  });
}
