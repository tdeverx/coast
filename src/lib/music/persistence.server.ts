import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getDb, type Database } from '$lib/server/db';
import { works, musicWorks, workIdentifiers, providerItems, workEditions, mediaRelationships, musicArtists, musicCredits, musicListens, musicListenBatches,musicProgress, availability, providerConnections, providerInstances, users } from '$lib/server/db/schema';
import type { MusicItem } from './model';
import { DomainError } from '$lib/core/errors';
import * as v from 'valibot';
import { assertJobLease, JobYield } from '$lib/server/queue/execution';
import { jellyfinItemKey } from '$lib/providers/jellyfin/paging';
import { musicAlbumMembers } from './editions.server';

type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
const sameMetadata = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
/** Shared provider metadata must never carry one account's personal state. */
export function musicMetadataSnapshot(item: MusicItem) {
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
    const artist=await persistArtist(getDb(),instanceId,item.id,item.title);return { ...item,artistId:artist.id };
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
    const snapshot=musicMetadataSnapshot(item);
    const externalId=mapping?.externalId??item.id;
    const [saved]=await tx.insert(providerItems).values({instanceId,externalId,mediaId:id,kind,snapshot,lastSeenAt:new Date()}).onConflictDoUpdate({target:[providerItems.instanceId,providerItems.externalId],set:{snapshot,lastSeenAt:new Date()}}).returning();
    const metadata={externalIds:item.externalIds,albumExternalId:item.albumId??null,position:(item.discNumber??1)*10000+(item.trackNumber??0),discNumber:item.discNumber??null,trackNumber:item.trackNumber??null};
    const [knownEdition]=await tx.select().from(workEditions).where(and(eq(workEditions.instanceId,instanceId),sql`replace(lower(${workEditions.externalId}),'-','')=${item.id}`)).orderBy(workEditions.id).limit(1);
    const [edition]=knownEdition
      ? sameMetadata(knownEdition.metadata,metadata) ? [knownEdition] : await tx.update(workEditions).set({metadata}).where(eq(workEditions.id,knownEdition.id)).returning()
      : await tx.insert(workEditions).values({workId:id,instanceId,externalId,format:'audio',metadata}).returning();
    if(kind==='album')await tx.update(musicWorks).set({selectedEditionId:edition.id}).where(and(eq(musicWorks.id,id),sql`${musicWorks.selectedEditionId} is null`));
    for(const [role,artists] of [['artist',item.artists],['album-artist',item.albumArtists]] as const) for(const a of artists){
      const artist=await persistArtist(tx,instanceId,a.id,a.name);
      await tx.insert(musicCredits).values({workId:id,artistId:artist.id,role}).onConflictDoNothing();
    }
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

async function persistArtist(tx: Transaction | Database,instanceId:string,externalId:string,name:string){
  // Retain existing UUIDs/preferences when an older endpoint used GUID hyphens.
  const [existing]=await tx.select().from(musicArtists).where(and(eq(musicArtists.instanceId,instanceId),sql`replace(lower(${musicArtists.externalId}),'-','')=${externalId}`)).orderBy(musicArtists.id).limit(1);
  if(existing){if(existing.name===name)return existing;const [saved]=await tx.update(musicArtists).set({name}).where(eq(musicArtists.id,existing.id)).returning();return saved;}
  const [saved]=await tx.insert(musicArtists).values({instanceId,externalId,name}).onConflictDoUpdate({target:[musicArtists.instanceId,musicArtists.externalId],set:{name}}).returning();return saved;
}
async function assertMusicAccount(tx:Transaction,userId:string,connectionId:string,instanceId:string,accountGeneration:string,expectedResetId?:string|null){
  const [connection]=await tx.select().from(providerConnections).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId),eq(providerConnections.accountGeneration,accountGeneration),eq(providerConnections.status,'connected'))).for('update');
  const [active]=await tx.select({id:users.id}).from(users).innerJoin(providerInstances,eq(providerInstances.id,instanceId))
    .where(and(eq(users.id,userId),eq(users.disabled,false),eq(providerInstances.enabled,true)));
  if(!connection||!active)throw new Error('The connected account changed during this task.');
  if(expectedResetId!==undefined&&(connection.settings.userSyncResetId??null)!==expectedResetId)throw new JobYield();
  await assertJobLease(tx,true);
}
/** Rich browse observations still refresh changed metadata/artwork, then grant
 * the bounded page together under the current account generation. */
export async function observeMusicLibraryAccess(userId:string,connectionId:string,instanceId:string,accountGeneration:string,items:MusicItem[]){
  const saved: (MusicItem & {providerItemId?:string})[]=[];
  for(const item of items)saved.push(await persistMusic(instanceId,item));
  await getDb().transaction(async tx=>{
    await assertMusicAccount(tx,userId,connectionId,instanceId,accountGeneration);
    const rows=new Map(saved.filter(item=>item.workId&&item.providerItemId).map(item=>[item.providerItemId!,{
      userId,connectionId,mediaId:item.workId!,providerItemId:item.providerItemId!,sourceId:'default',durationSeconds:item.durationSeconds,state:'available' as const,verifiedAt:new Date(),
    }]));
    if(rows.size)await tx.insert(availability).values([...rows.values()]).onConflictDoUpdate({target:[availability.userId,availability.connectionId,availability.providerItemId,availability.sourceId],
      set:{mediaId:sql`excluded.media_id`,durationSeconds:sql`excluded.duration_seconds`,state:'available',verifiedAt:sql`excluded.verified_at`}});
  });
  return saved;
}
export async function observeMusicAccess(userId:string,connectionId:string,instanceId:string,item:MusicItem,accountGeneration:string){
  return (await observeMusicLibraryAccess(userId,connectionId,instanceId,accountGeneration,[item]))[0];
}

/** User sync reuses shared music metadata and grants only this authenticated page's access. */
export async function observeMusicPageAccess(userId: string, connectionId: string, instanceId: string,
  accountGeneration: string, items: MusicItem[], scanId: string,
  loadMissing?: (ids: string[]) => Promise<MusicItem[]>, readStage = 'music', expectedResetId?:string|null) {
  if (!items.length) return [];
  items=items.map(item=>({...item,id:jellyfinItemKey(item.id)}));
  const db = getDb();
  const known = await db.select({externalId: providerItems.externalId, providerItemId: providerItems.id, workId: musicWorks.id, kind: musicWorks.kind})
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
  for (const item of items) {
    const mapping = mappings.get(item.id);
    if(mapping?.kind===item.kind)saved.push({...item,workId:mapping.workId,providerItemId:mapping.providerItemId});
    else {
      const detail=details.get(item.id);
      // An item removed or denied between the page and detail query grants no access.
      if(!detail)continue;
      if(detail.kind!==item.kind)throw new Error('Jellyfin returned an unexpected music item type.');
      saved.push({...await persistMusic(instanceId,detail),favourite:item.favourite,playCount:item.playCount,positionSeconds:item.positionSeconds,expectedMembers:item.expectedMembers});
    }
  }
  await db.transaction(async tx => {
    await assertMusicAccount(tx,userId,connectionId,instanceId,accountGeneration,expectedResetId);
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
  const [event]=await tx.insert(musicListens).values({userId,trackId,batchId,source,occurredAt,occurredAtKnown:known}).onConflictDoNothing().returning();
  if(event) await tx.insert(musicProgress).values({userId,trackId,playCount:1}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:sql`${musicProgress.playCount}+1`,positionSeconds:0,updatedAt:new Date()}});
  if(event)await (await import('$lib/server/public-api/webhooks.server')).emitWebhook(tx,userId,'music.listened',{workId:trackId,listenId:event.id,occurredAt:occurredAt?.toISOString()??event.occurredAt?.toISOString()??null,occurredAtKnown:known});
  return event;
}
export async function logMusic(userId:string,workId:string,input:unknown,transaction?:Transaction){
  const data=v.parse(v.strictObject({batchId:v.pipe(v.string(),v.uuid()),occurredAt:v.optional(v.pipe(v.string(),v.isoTimestamp(),v.check(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now(),'Listens must have a valid date in the past.')))}),input);
  const apply=async(tx:Transaction)=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [previous]=await tx.select().from(musicListenBatches).where(and(eq(musicListenBatches.userId,userId),eq(musicListenBatches.batchId,data.batchId)));
    if(previous){if(previous.workId!==workId)throw new DomainError('This listen batch belongs to another work.',409);return {added:0,batchId:data.batchId};}
    const [work]=await tx.select().from(musicWorks).where(eq(musicWorks.id,workId));if(!work)throw new DomainError('Music not found.',404);
    const tracks=work.kind==='track'?[{id:workId,entryId:workId}]:await musicAlbumMembers(workId,tx);
    if(!tracks.length)throw new DomainError('No known tracks to log.');
    await tx.insert(musicListenBatches).values({userId,batchId:data.batchId,workId,tracks:tracks.map(t=>t.id)});
    const { enqueueSyncValueInTransaction, enqueueCollectionProjectionInTransaction } = await import('$lib/sync/changes.server');
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
