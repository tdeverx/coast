import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb, type Database } from '$lib/server/db';
import { works, musicWorks, workIdentifiers, providerItems, workEditions, mediaRelationships, musicArtists, musicCredits, musicListens, musicListenBatches,musicProgress, availability, providerConnections, providerInstances, users } from '$lib/server/db/schema';
import type { MusicItem } from './model';
import { DomainError } from '$lib/core/errors';
import * as v from 'valibot';
import { assertJobLease } from '$lib/server/queue/execution';

type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
/** Shared provider metadata must never carry one account's personal state. */
export function musicMetadataSnapshot(item: MusicItem) {
  return {id:item.id,kind:item.kind,title:item.title,artists:item.artists,albumArtists:item.albumArtists,
    artistNames:item.artistNames,album:item.album,albumId:item.albumId,discNumber:item.discNumber,
    trackNumber:item.trackNumber,durationSeconds:item.durationSeconds,releaseDate:item.releaseDate,
    year:item.year,genres:item.genres,overview:item.overview,primaryImageTag:item.primaryImageTag,
    externalIds:item.externalIds};
}
/** Only MusicBrainz identifiers with explicit recording/release-group semantics merge works. */
export async function persistMusic(instanceId: string, item: MusicItem): Promise<MusicItem & { providerItemId?: string }> {
  if(item.kind==='artist') {
    const [artist]=await getDb().insert(musicArtists).values({instanceId,externalId:item.id,name:item.title}).onConflictDoUpdate({target:[musicArtists.instanceId,musicArtists.externalId],set:{name:item.title}}).returning();return { ...item,artistId:artist.id };
  }
  const kind=item.kind;
  return getDb().transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`music:${instanceId}:${item.id}`},0))`);
    const identifier=item.externalIds[item.kind==='album'?'musicbrainzreleasegroup':'musicbrainztrack'];
    const verified=identifier && v.safeParse(v.pipe(v.string(),v.uuid()),identifier).success?identifier.toLowerCase():null;
    const provider=item.kind==='album'?'musicbrainz-release-group':'musicbrainz-recording';
    if(verified) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${provider}:${verified}`},0))`);
    const [mapping]=await tx.select().from(providerItems).where(and(eq(providerItems.instanceId,instanceId),eq(providerItems.externalId,item.id)));
    const [identity]=verified?await tx.select().from(workIdentifiers).where(and(eq(workIdentifiers.provider,provider),eq(workIdentifiers.externalId,verified),eq(workIdentifiers.kind,kind))):[];
    if(mapping && identity && mapping.mediaId!==identity.workId) throw new DomainError('Conflicting music identities require review.',409);
    const id=mapping?.mediaId??identity?.workId??crypto.randomUUID();
    await tx.insert(works).values({id,category:'music',kind}).onConflictDoNothing();
    const data={id,title:item.title,kind,artistNames:item.artistNames.length?item.artistNames:item.artists.map(a=>a.name),releaseDate:item.releaseDate,year:item.year,durationSeconds:item.durationSeconds,overview:item.overview,genres:item.genres,updatedAt:new Date()};
    await tx.insert(musicWorks).values(data).onConflictDoUpdate({target:musicWorks.id,set:data});
    if(verified) await tx.insert(workIdentifiers).values({workId:id,provider,externalId:verified,kind}).onConflictDoNothing();
    const snapshot=musicMetadataSnapshot(item);
    const [saved]=await tx.insert(providerItems).values({instanceId,externalId:item.id,mediaId:id,kind,snapshot,lastSeenAt:new Date()}).onConflictDoUpdate({target:[providerItems.instanceId,providerItems.externalId],set:{snapshot,lastSeenAt:new Date()}}).returning();
    await tx.insert(workEditions).values({workId:id,instanceId,externalId:item.id,format:'audio',metadata:{externalIds:item.externalIds}}).onConflictDoUpdate({target:[workEditions.instanceId,workEditions.externalId],set:{metadata:{externalIds:item.externalIds}}});
    for(const [role,artists] of [['artist',item.artists],['album-artist',item.albumArtists]] as const) for(const a of artists){
      const [artist]=await tx.insert(musicArtists).values({instanceId,externalId:a.id,name:a.name}).onConflictDoUpdate({target:[musicArtists.instanceId,musicArtists.externalId],set:{name:a.name}}).returning();
      await tx.insert(musicCredits).values({workId:id,artistId:artist.id,role}).onConflictDoNothing();
    }
    if(item.albumId){const [album]=await tx.select().from(providerItems).where(and(eq(providerItems.instanceId,instanceId),eq(providerItems.externalId,item.albumId),eq(providerItems.kind,'album')));
      if(album) await tx.insert(mediaRelationships).values({parentId:album.mediaId,childId:id,kind:'contains',position:(item.discNumber??1)*10000+(item.trackNumber??0)}).onConflictDoUpdate({target:[mediaRelationships.parentId,mediaRelationships.childId,mediaRelationships.kind],set:{position:(item.discNumber??1)*10000+(item.trackNumber??0)}});
    }
    return {...item,workId:id,providerItemId:saved.id};
  });
}
export async function observeMusicAccess(userId: string, connectionId: string, instanceId: string, item: MusicItem, scanId?: string) {
  const saved=await persistMusic(instanceId,item);
  if(!('workId' in saved)||!saved.workId||!('providerItemId' in saved))return saved;
  const data={userId,connectionId,mediaId:saved.workId,providerItemId:saved.providerItemId!,sourceId:'default',durationSeconds:item.durationSeconds,state:'available' as const,scanId,verifiedAt:new Date()};
  await getDb().insert(availability).values(data).onConflictDoUpdate({target:[availability.userId,availability.connectionId,availability.providerItemId,availability.sourceId],set:data});
  return saved;
}

/** User sync reuses shared music metadata and grants only this authenticated page's access. */
export async function observeMusicPageAccess(userId: string, connectionId: string, instanceId: string,
  accountGeneration: string, items: MusicItem[], scanId: string,
  loadMissing?: (ids: string[]) => Promise<MusicItem[]>) {
  if (!items.length) return [];
  const db = getDb();
  const known = await db.select({externalId: providerItems.externalId, providerItemId: providerItems.id, workId: musicWorks.id, kind: musicWorks.kind})
    .from(providerItems).innerJoin(musicWorks, eq(musicWorks.id, providerItems.mediaId))
    .where(and(eq(providerItems.instanceId, instanceId), inArray(providerItems.externalId, items.map(item => item.id))));
  const mappings = new Map(known.map(row => [row.externalId, row]));
  const missing=items.filter(item=>mappings.get(item.id)?.kind!==item.kind);
  const hydrated=loadMissing && missing.length ? await loadMissing([...new Set(missing.map(item=>item.id))]) : missing;
  const details=new Map(hydrated.map(item=>[item.id,item]));
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
    const [connection] = await tx.select().from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, instanceId), eq(providerConnections.accountGeneration, accountGeneration), eq(providerConnections.status, 'connected'))).for('update');
    const [active] = await tx.select({id: users.id}).from(users).innerJoin(providerInstances, eq(providerInstances.id, instanceId))
      .where(and(eq(users.id, userId), eq(users.disabled, false), eq(providerInstances.enabled, true)));
    if (!connection || !active) throw new Error('The connected account changed during this task.');
    await assertJobLease(tx,true);
    const rows = new Map(saved.filter(item => item.workId && item.providerItemId).map(item => [item.providerItemId!, {
      userId, connectionId, mediaId: item.workId!, providerItemId: item.providerItemId!, sourceId: 'default',
      durationSeconds: item.durationSeconds, source:{coastMembershipCount:item.expectedMembers??null},state: 'available' as const, scanId, verifiedAt: new Date(),
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
  const data=v.parse(v.strictObject({batchId:v.pipe(v.string(),v.uuid()),occurredAt:v.optional(v.pipe(v.string(),v.isoTimestamp()))}),input);
  const apply=async(tx:Transaction)=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [previous]=await tx.select().from(musicListenBatches).where(and(eq(musicListenBatches.userId,userId),eq(musicListenBatches.batchId,data.batchId)));
    if(previous){if(previous.workId!==workId)throw new DomainError('This listen batch belongs to another work.',409);return {added:0,batchId:data.batchId};}
    const [work]=await tx.select().from(musicWorks).where(eq(musicWorks.id,workId));if(!work)throw new DomainError('Music not found.',404);
    const tracks=work.kind==='track'?[{id:workId}]:await tx.select({id:musicWorks.id}).from(mediaRelationships).innerJoin(musicWorks,eq(musicWorks.id,mediaRelationships.childId)).where(and(eq(mediaRelationships.parentId,workId),eq(mediaRelationships.kind,'contains'),eq(musicWorks.kind,'track')));
    if(!tracks.length)throw new DomainError('No known tracks to log.');
    await tx.insert(musicListenBatches).values({userId,batchId:data.batchId,workId,tracks:tracks.map(t=>t.id)});
    const { enqueueSyncValueInTransaction, enqueueCollectionProjectionInTransaction } = await import('$lib/sync/changes');
    let added = 0;
    for (const track of tracks) {
      if (await recordMusicListen(tx, userId, track.id, data.batchId, 'coast', data.occurredAt ? new Date(data.occurredAt) : undefined)) {
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
