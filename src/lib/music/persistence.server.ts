import { requireFeatureInTransaction } from '#lib/server/features.js';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getDb, type Database } from '#lib/server/db/index.js';
import { works, musicWorks, workIdentifiers, providerItems, workEditions, mediaRelationships, musicArtists, musicCredits, musicListenBatches,musicProgress, availability, providerConnections, providerInstances, users } from '#lib/server/db/schema.js';
import type { MusicItem } from './model';
import { DomainError } from '#lib/core/errors.js';
import * as v from 'valibot';
import { assertJobLease, JobYield } from '#lib/server/queue/execution.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { saveJellyfinAddedDates } from '#lib/providers/jellyfin/added-date.server.js';
import { retainedMusicListenSql } from './history.server';
import { musicAlbumMembers } from './editions.server';

type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
const sameMetadata = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
/** Shared provider metadata must never carry one account's personal state. */
function musicMetadataSnapshot(item: MusicItem) {
  return {id:item.id,kind:item.kind,title:item.title,artists:item.artists.map(({id,name})=>({id,name})),albumArtists:item.albumArtists.map(({id,name})=>({id,name})),
    artistNames:item.artistNames,album:item.album,albumId:item.albumId,discNumber:item.discNumber,
    trackNumber:item.trackNumber,durationSeconds:item.durationSeconds,releaseDate:item.releaseDate,
    year:item.year,genres:item.genres,overview:item.overview,primaryImageTag:item.primaryImageTag,
    externalIds:item.externalIds};
}
/** Only MusicBrainz identifiers with explicit recording/release-group semantics merge works. */
export async function persistMusic(instanceId: string, item: MusicItem): Promise<MusicItem & { providerItemId?: string }> {
  item={...item,id:jellyfinItemKey(item.id),albumId:item.albumId?jellyfinItemKey(item.albumId):undefined,
    artists:item.artists.map(artist=>({...artist,id:jellyfinItemKey(artist.id)})),albumArtists:item.albumArtists.map(artist=>({...artist,id:jellyfinItemKey(artist.id)}))};
  if(item.kind==='artist') {
    return getDb().transaction(async tx => {
      const artist=await persistArtist(tx,instanceId,item.id,item.title,item.externalIds.musicbrainzartist);
      const metadata={title:item.title,overview:item.overview??null,genres:item.genres,updatedAt:new Date()};
      await tx.insert(musicWorks).values({id:artist.workId,kind:'artist',...metadata}).onConflictDoUpdate({target:musicWorks.id,set:metadata,
        setWhere:sql`(${musicWorks.title},${musicWorks.overview},${musicWorks.genres}) is distinct from (excluded.title,excluded.overview,excluded.genres)`});
      const snapshot=musicMetadataSnapshot(item);
      snapshot.externalIds={...snapshot.externalIds};
      if(!v.safeParse(v.pipe(v.string(),v.uuid()),snapshot.externalIds.musicbrainzartist).success)delete snapshot.externalIds.musicbrainzartist;
      const [saved]=await tx.insert(providerItems).values({instanceId,externalId:artist.externalId,mediaId:artist.workId,kind:'artist',snapshot})
        .onConflictDoUpdate({target:[providerItems.instanceId,providerItems.externalId],set:{
          // Missing optional metadata cannot erase a source's verified identity.
          snapshot:sql`excluded.snapshot || jsonb_build_object('externalIds',coalesce(${providerItems.snapshot}->'externalIds','{}'::jsonb) || (excluded.snapshot->'externalIds'))`,
          lastSeenAt:new Date(),
        }}).returning();
      return {...item,workId:artist.workId,artistId:artist.id,providerItemId:saved.id};
    });
  }
  const kind=item.kind;
  return getDb().transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`music:${instanceId}:${item.id}`},0))`);
    const identifier=item.externalIds[item.kind==='album'?'musicbrainzreleasegroup':'musicbrainztrack'];
    const verified=identifier && v.safeParse(v.pipe(v.string(),v.uuid()),identifier).success?identifier.toLowerCase():null;
    const provider=item.kind==='album'?'musicbrainz-release-group':'musicbrainz-recording';
    if(verified) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${provider}:${verified}`},0))`);
    const mappings=await tx.select().from(providerItems).where(and(eq(providerItems.instanceId,instanceId),sql`${providerItems.kind} in ('album','track')`,sql`replace(lower(${providerItems.externalId}),'-','')=${item.id}`));
    if(new Set(mappings.map(mapping=>mapping.mediaId)).size>1)throw new DomainError('Conflicting music identities require review.',409);
    const mapping=mappings.sort((a,b)=>a.externalId.localeCompare(b.externalId)||a.id.localeCompare(b.id))[0];
    const [identity]=verified?await tx.select().from(workIdentifiers).where(and(eq(workIdentifiers.provider,provider),eq(workIdentifiers.externalId,verified),eq(workIdentifiers.kind,kind))):[];
    if(mapping && identity && mapping.mediaId!==identity.workId) throw new DomainError('Conflicting music identities require review.',409);
    const id=mapping?.mediaId??identity?.workId??crypto.randomUUID();
    await tx.insert(works).values({id,category:'music',kind}).onConflictDoNothing();
    const data={id,title:item.title,kind,artistNames:item.artistNames.length?item.artistNames:(kind==='album'?item.albumArtists:item.artists).map(a=>a.name),releaseDate:item.releaseDate,year:item.year,durationSeconds:item.durationSeconds,overview:item.overview,genres:item.genres,updatedAt:new Date()};
    await tx.insert(musicWorks).values(data).onConflictDoUpdate({target:musicWorks.id,set:data,
      setWhere:sql`(${musicWorks.title},${musicWorks.kind},${musicWorks.artistNames},${musicWorks.releaseDate},${musicWorks.year},${musicWorks.durationSeconds},${musicWorks.overview},${musicWorks.genres})
        is distinct from (excluded.title,excluded.kind,excluded.artist_names,excluded.release_date,excluded.year,excluded.duration_seconds,excluded.overview,excluded.genres)`});
    if(verified) await tx.insert(workIdentifiers).values({workId:id,provider,externalId:verified,kind}).onConflictDoNothing();
    const snapshot={...musicMetadataSnapshot(item),addedAt:item.addedAt??mapping?.snapshot.addedAt};
    const externalId=mapping?.externalId??item.id;
    const [saved]=await tx.insert(providerItems).values({instanceId,externalId,mediaId:id,kind,snapshot,lastSeenAt:new Date()}).onConflictDoUpdate({target:[providerItems.instanceId,providerItems.externalId],set:{snapshot:sql`excluded.snapshot`,lastSeenAt:new Date()}}).returning();
    const metadata={externalIds:item.externalIds,albumExternalId:item.albumId??null,position:(item.discNumber??1)*10000+(item.trackNumber??0),discNumber:item.discNumber??null,trackNumber:item.trackNumber??null};
    const [knownEdition]=await tx.select().from(workEditions).where(and(eq(workEditions.instanceId,instanceId),sql`replace(lower(${workEditions.externalId}),'-','')=${item.id}`)).orderBy(workEditions.id).limit(1);
    const [edition]=knownEdition
      ? sameMetadata(knownEdition.metadata,metadata) ? [knownEdition] : await tx.update(workEditions).set({metadata}).where(eq(workEditions.id,knownEdition.id)).returning()
      : await tx.insert(workEditions).values({workId:id,instanceId,externalId,format:'audio',metadata}).returning();
    if(kind==='album')await tx.update(musicWorks).set({selectedEditionId:edition.id}).where(and(eq(musicWorks.id,id),sql`${musicWorks.selectedEditionId} is null`));
    const credited=new Map([...item.artists,...item.albumArtists].map(artist=>[artist.id,artist]));
    const aliases=new Map<string,string>();
    // Shared credit locks are acquired in stable order across concurrent tracks.
    for(const a of [...credited.values()].sort((a,b)=>a.id.localeCompare(b.id)))aliases.set(a.id,(await persistArtist(tx,instanceId,a.id,a.name)).workId);
    for(const [role,artists] of [['artist',item.artists],['album-artist',item.albumArtists]] as const)for(const a of artists)
      await tx.insert(musicCredits).values({workId:id,artistId:aliases.get(a.id)!,role}).onConflictDoNothing();
    // Only the selected release projects membership to shared Collection queries.
    // Rebuild from its exact occurrences, including tracks observed before albums.
    const albumIds=[...new Set([item.albumId,typeof knownEdition?.metadata.albumExternalId==='string'?jellyfinItemKey(knownEdition.metadata.albumExternalId):undefined].filter((value):value is string=>!!value))];
    const projectionChanged=!knownEdition || knownEdition.workId!==id || knownEdition.metadata.albumExternalId!==metadata.albumExternalId || knownEdition.metadata.position!==metadata.position;
    const albums=kind==='album'?[{id}]:projectionChanged&&albumIds.length?await tx.select({id:musicWorks.id}).from(workEditions).innerJoin(musicWorks,eq(musicWorks.selectedEditionId,workEditions.id)).where(and(eq(workEditions.instanceId,instanceId),sql`replace(lower(${workEditions.externalId}),'-','') in (${sql.join(albumIds.map(albumId=>sql`${albumId}`),sql`,`)})`)).orderBy(musicWorks.id):[];
    for(const album of albums){
      await tx.select({id:musicWorks.id}).from(musicWorks).where(eq(musicWorks.id,album.id)).for('update');
      const members=await musicAlbumMembers(album.id,tx),positions=new Map<string,number>();
      for(const member of members)if(!positions.has(member.id))positions.set(member.id,member.position);
      const previous=await tx.select({childId:mediaRelationships.childId,position:mediaRelationships.position}).from(mediaRelationships)
        .where(and(eq(mediaRelationships.parentId,album.id),eq(mediaRelationships.kind,'contains')));
      const existing=new Map(previous.map(member=>[member.childId,member.position]));
      const removed=previous.filter(member=>!positions.has(member.childId)).map(member=>member.childId);
      const changed=[...positions].filter(([childId,position])=>existing.get(childId)!==position)
        .map(([childId,position])=>({parentId:album.id,childId,kind:'contains' as const,position}));
      for(let offset=0;offset<removed.length;offset+=100)await tx.delete(mediaRelationships).where(and(eq(mediaRelationships.parentId,album.id),eq(mediaRelationships.kind,'contains'),sql`${mediaRelationships.childId} in (${sql.join(removed.slice(offset,offset+100).map(id=>sql`${id}::uuid`),sql`,`)})`));
      for(let offset=0;offset<changed.length;offset+=100)await tx.insert(mediaRelationships).values(changed.slice(offset,offset+100))
        .onConflictDoUpdate({target:[mediaRelationships.parentId,mediaRelationships.childId,mediaRelationships.kind],set:{position:sql`excluded.position`}});
    }
    return {...item,workId:id,providerItemId:saved.id};
  });
}

async function persistArtist(tx: Transaction,instanceId:string,externalId:string,name:string,identifier?:string){
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`music:${instanceId}:${externalId}`},0))`);
  const verified=identifier && v.safeParse(v.pipe(v.string(),v.uuid()),identifier).success?identifier.toLowerCase():null;
  if(verified)await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`musicbrainz-artist:${verified}`},0))`);
  // Retain existing UUIDs/preferences when an older endpoint used GUID hyphens.
  const [existing]=await tx.select().from(musicArtists).where(and(eq(musicArtists.instanceId,instanceId),sql`replace(lower(${musicArtists.externalId}),'-','')=${externalId}`)).orderBy(musicArtists.id).limit(1);
  if(existing&&!verified&&existing.name===name)return existing;
  const [identity]=verified?await tx.select().from(workIdentifiers).where(and(eq(workIdentifiers.provider,'musicbrainz-artist'),eq(workIdentifiers.externalId,verified),eq(workIdentifiers.kind,'artist'))):[];
  if(existing&&verified){
    const [known]=await tx.select({externalId:workIdentifiers.externalId}).from(workIdentifiers)
      .where(and(eq(workIdentifiers.workId,existing.workId),eq(workIdentifiers.provider,'musicbrainz-artist'),eq(workIdentifiers.kind,'artist'))).limit(1);
    if(known&&known.externalId!==verified)throw new DomainError('Conflicting artist identities require review.',409);
    // Source-backed provisional works may already carry personal choices. Keep
    // their identity stable when another work owns this verified identifier.
    // Retain this source's assertion in its snapshot so later contradictions
    // still require review, without merging or silently rekeying user data.
    if(!known){
      const [source]=await tx.select({snapshot:providerItems.snapshot}).from(providerItems)
        .where(and(eq(providerItems.instanceId,instanceId),eq(providerItems.externalId,existing.externalId),eq(providerItems.kind,'artist')));
      const previous=v.safeParse(v.object({musicbrainzartist:v.optional(v.pipe(v.string(),v.uuid()))}),source?.snapshot.externalIds);
      if(previous.success&&previous.output.musicbrainzartist&&previous.output.musicbrainzartist.toLowerCase()!==verified)
        throw new DomainError('Conflicting artist identities require review.',409);
    }
  }
  const workId=existing?.workId??identity?.workId??crypto.randomUUID();
  await tx.insert(works).values({id:workId,category:'music',kind:'artist'}).onConflictDoNothing();
  await tx.insert(musicWorks).values({id:workId,kind:'artist',title:name}).onConflictDoUpdate({target:musicWorks.id,set:{title:name,updatedAt:new Date()},setWhere:sql`${musicWorks.title} is distinct from excluded.title`});
  if(verified)await tx.insert(workIdentifiers).values({workId,provider:'musicbrainz-artist',externalId:verified,kind:'artist'}).onConflictDoNothing();
  if(existing){if(existing.name===name)return existing;const [saved]=await tx.update(musicArtists).set({name}).where(eq(musicArtists.id,existing.id)).returning();return saved;}
  const [saved]=await tx.insert(musicArtists).values({workId,instanceId,externalId,name}).returning();return saved;
}
async function assertMusicAccount(tx:Transaction,userId:string,connectionId:string,instanceId:string,accountGeneration:string,expectedResetId?:string|null){
 await requireFeatureInTransaction(tx,userId,'music');
  const [connection]=await tx.select().from(providerConnections).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId),eq(providerConnections.accountGeneration,accountGeneration),eq(providerConnections.status,'connected'))).for('update');
  const [active]=await tx.select({id:users.id}).from(users).innerJoin(providerInstances,eq(providerInstances.id,instanceId))
    .where(and(eq(users.id,userId),eq(users.disabled,false),eq(providerInstances.enabled,true)));
  if(!connection||!active)throw new DomainError('The connected account changed during this task.', 409, 'source_changed');
  if(expectedResetId!==undefined&&(connection.settings.userSyncResetId??null)!==expectedResetId)throw new JobYield();
  await assertJobLease(tx,true);
}
/** Rich browse observations still refresh changed metadata/artwork, then grant
 * the bounded page together under the current account generation. */
export async function observeMusicLibraryAccess(userId:string,connectionId:string,instanceId:string,accountGeneration:string,items:MusicItem[],signal?:AbortSignal){
  const saved: (MusicItem & {providerItemId?:string})[]=[];
  for(const item of items){signal?.throwIfAborted();saved.push(await persistMusic(instanceId,item));}
  await getDb().transaction(async tx=>{
    signal?.throwIfAborted();
    await assertMusicAccount(tx,userId,connectionId,instanceId,accountGeneration);
    signal?.throwIfAborted();
    const rows=new Map(saved.filter(item=>item.workId&&item.providerItemId).map(item=>[item.providerItemId!,{
      userId,connectionId,mediaId:item.workId!,providerItemId:item.providerItemId!,sourceId:'default',durationSeconds:item.durationSeconds,state:'available' as const,verifiedAt:new Date(),
    }]));
    if(rows.size)await tx.insert(availability).values([...rows.values()]).onConflictDoUpdate({target:[availability.userId,availability.connectionId,availability.providerItemId,availability.sourceId],
      set:{mediaId:sql`excluded.media_id`,durationSeconds:sql`excluded.duration_seconds`,state:'available',verifiedAt:sql`excluded.verified_at`}});
    signal?.throwIfAborted();
  });
  return saved;
}
export async function observeMusicAccess(userId:string,connectionId:string,instanceId:string,item:MusicItem,accountGeneration:string,signal?:AbortSignal){
  return (await observeMusicLibraryAccess(userId,connectionId,instanceId,accountGeneration,[item],signal))[0];
}

/** User sync reuses shared music metadata and grants only this authenticated page's access. */
export async function observeMusicPageAccess(userId: string, connectionId: string, instanceId: string,
  accountGeneration: string, items: MusicItem[], scanId: string,
  loadMissing?: (ids: string[]) => Promise<MusicItem[]>, readStage = 'music', expectedResetId?:string|null) {
  if (!items.length) return [];
  items=items.map(item=>({...item,id:jellyfinItemKey(item.id)}));
  const db = getDb();
  const known = await db.select({externalId: providerItems.externalId, providerItemId: providerItems.id, workId: musicWorks.id, kind: musicWorks.kind,
    addedAt:sql<string | null>`${providerItems.snapshot}->>'addedAt'`})
    .from(providerItems).innerJoin(musicWorks, eq(musicWorks.id, providerItems.mediaId))
    .where(and(eq(providerItems.instanceId, instanceId),sql`${providerItems.kind} in ('album','track')`,sql`replace(lower(${providerItems.externalId}),'-','') in (${sql.join(items.map(item=>sql`${item.id}`),sql`,`)})`));
  const mappings = new Map<string,typeof known[number]>();
  for(const row of known){const key=jellyfinItemKey(row.externalId),previous=mappings.get(key);
    if(previous&&previous.workId!==row.workId)throw new DomainError('Conflicting music identities require review.',409);
    if(!previous||row.providerItemId<previous.providerItemId)mappings.set(key,row);
  }
  const missing=items.filter(item=>mappings.get(item.id)?.kind!==item.kind);
  const hydrated=loadMissing && missing.length ? await loadMissing([...new Set(missing.map(item=>item.id))]) : missing;
  const details=new Map(hydrated.map(item=>[jellyfinItemKey(item.id),item]));
  const saved: (MusicItem & {providerItemId?: string})[] = [];
  const addedDates = new Map<string,string>();
  for (const item of items) {
    const mapping = mappings.get(item.id);
    if(mapping?.kind===item.kind){
      saved.push({...item,workId:mapping.workId,providerItemId:mapping.providerItemId});
      if(item.addedAt && item.addedAt!==mapping.addedAt)addedDates.set(mapping.providerItemId,item.addedAt);
    }
    else {
      const detail=details.get(item.id);
      // An item removed or denied between the page and detail query grants no access.
      if(!detail)continue;
      if(detail.kind!==item.kind)throw new Error('Jellyfin returned an unexpected music item type.');
      saved.push({...await persistMusic(instanceId,{...detail,addedAt:detail.addedAt??item.addedAt}),favourite:item.favourite,playCount:item.playCount,positionSeconds:item.positionSeconds,expectedMembers:item.expectedMembers});
    }
  }
  await db.transaction(async tx => {
    await assertMusicAccount(tx,userId,connectionId,instanceId,accountGeneration,expectedResetId);
    await saveJellyfinAddedDates(tx, addedDates);
    const rows = new Map(saved.filter(item => item.workId && item.providerItemId).map(item => [item.providerItemId!, {
      userId, connectionId, mediaId: item.workId!, providerItemId: item.providerItemId!, sourceId: 'default',
      durationSeconds: item.durationSeconds, source:{coastMembershipCount:item.expectedMembers??null,coastReadStage:readStage,coastMusicGeneration:accountGeneration,coastMusicData:{favourite:item.favourite??null,playCount:item.playCount??0,positionSeconds:item.positionSeconds??0}},state: 'available' as const, scanId, verifiedAt: new Date(),
    }]));
    if (rows.size) await tx.insert(availability).values([...rows.values()]).onConflictDoUpdate({
      target: [availability.userId, availability.connectionId, availability.providerItemId, availability.sourceId],
      set: {mediaId: sql`excluded.media_id`, durationSeconds: sql`excluded.duration_seconds`, source:sql`excluded.source`,state: 'available', scanId, verifiedAt: new Date()},
    });
  });
  return saved;
}
export async function recordMusicListen(tx: Transaction,userId: string,trackId:string,batchId:string,source='coast',occurredAt?:Date,known=true){
  const [event]=await tx.execute<{id:string;batchId:string;occurredAt:Date}>(sql`
    insert into music_listens(user_id,track_id,batch_id,source,occurred_at,occurred_at_known)
    select ${userId}::uuid,${trackId}::uuid,${batchId}::uuid,${source},${occurredAt??new Date()},${known}
    where ${retainedMusicListenSql(userId,trackId,batchId)} on conflict do nothing
    returning id,batch_id as "batchId",occurred_at as "occurredAt"`);
  if(event) await tx.insert(musicProgress).values({userId,trackId,playCount:1}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:sql`${musicProgress.playCount}+1`,positionSeconds:0,updatedAt:new Date()}});
  if(event)await (await import('#lib/server/public-api/webhooks.server.js')).emitWebhook(tx,userId,'music.listened',{workId:trackId,listenId:event.id,occurredAt:occurredAt?.toISOString()??event.occurredAt?.toISOString()??null,occurredAtKnown:known});
  return event;
}
/** Insert exact imported occurrences in batches of at most 100 rows.
 * Every batch remains in the caller's atomic reconciliation transaction. */
export async function recordImportedMusicListens(tx: Transaction,userId:string,trackId:string,accountId:string,start:number,end:number){
  let added=0;
  for(let offset=start;offset<end;offset+=100){
    const rows=Array.from({length:Math.min(100,end-offset)},(_,index)=>({userId,trackId,batchId:importedListenBatch(accountId,trackId,offset+index),source:'jellyfin',occurredAtKnown:false}));
    const events=await tx.execute<{id:string;batchId:string;occurredAt:Date}>(sql`
      insert into music_listens(user_id,track_id,batch_id,source,occurred_at_known)
      select ${userId}::uuid,${trackId}::uuid,incoming.batch_id::uuid,'jellyfin',false
      from jsonb_array_elements_text(${sql.param(rows.map(row=>row.batchId))}::jsonb) incoming(batch_id)
      where ${retainedMusicListenSql(userId,trackId,sql`incoming.batch_id`)} on conflict do nothing
      returning id,batch_id as "batchId",occurred_at as "occurredAt"`);
    if(!events.length)continue;
    added+=events.length;
    await tx.insert(musicProgress).values({userId,trackId,playCount:events.length}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:sql`${musicProgress.playCount}+${events.length}`,positionSeconds:0,updatedAt:new Date()}});
    const {emitWebhook}=await import('#lib/server/public-api/webhooks.server.js');
    const byBatch=new Map(events.map(event=>[event.batchId,event]));
    for(const row of rows){
      const event=byBatch.get(row.batchId);
      if(event)await emitWebhook(tx,userId,'music.listened',{workId:trackId,listenId:event.id,occurredAt:event.occurredAt?.toISOString()??null,occurredAtKnown:false});
    }
  }
  return added;
}
export async function logMusic(userId:string,workId:string,input:unknown,transaction?:Transaction){
  const data=v.parse(v.strictObject({batchId:v.pipe(v.string(),v.uuid()),occurredAt:v.optional(v.pipe(v.string(),v.isoTimestamp(),v.check(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now(),'Listens must have a valid date in the past.')))}),input);
  const apply=async(tx:Transaction)=>{
    await requireFeatureInTransaction(tx,userId,'music');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [previous]=await tx.select().from(musicListenBatches).where(and(eq(musicListenBatches.userId,userId),eq(musicListenBatches.batchId,data.batchId)));
    if(previous){if(previous.workId!==workId)throw new DomainError('This listen batch belongs to another work.',409);return {added:0,batchId:data.batchId};}
    const [work]=await tx.select().from(musicWorks).where(eq(musicWorks.id,workId));if(!work)throw new DomainError('Music not found.',404);
    if(work.kind==='artist')throw new DomainError('Choose a track by this artist to log a listen.');
    const tracks=work.kind==='track'?[{id:workId,entryId:workId}]:await musicAlbumMembers(workId,tx);
    if(!tracks.length)throw new DomainError('No known tracks to log.');
    await tx.insert(musicListenBatches).values({userId,batchId:data.batchId,workId,tracks:tracks.map(t=>t.id)});
    const { enqueueSyncValueInTransaction, enqueueCollectionProjectionInTransaction } = await import('#lib/sync/changes.server.js');
    let added = 0;
    for (const track of tracks) {
      const occurrenceBatch=work.kind==='track'?data.batchId:importedListenBatch(data.batchId,track.entryId,0);
      if (await recordMusicListen(tx, userId, track.id, occurrenceBatch, 'coast', data.occurredAt ? new Date(data.occurredAt) : undefined)) {
        added++;
        await enqueueSyncValueInTransaction(tx, userId, track.id, 'history', { value: true });
      }
    }
    if (added) await enqueueCollectionProjectionInTransaction(tx, userId);
    return {added,batchId:data.batchId};
  };
  return transaction?apply(transaction):getDb().transaction(apply);
}
export function importedListenBatch(connectionId:string,itemId:string,index:number){const h=createHash('sha256').update(`${connectionId}:${itemId}:${index}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
