import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb, type Database } from '$lib/server/db';
import { works, musicWorks, workIdentifiers, providerItems, workEditions, mediaRelationships, musicArtists, musicCredits, musicListens, musicListenBatches,musicProgress, availability } from '$lib/server/db/schema';
import type { MusicItem } from './model';
import { DomainError } from '$lib/core/errors';
import * as v from 'valibot';

type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
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
    const [saved]=await tx.insert(providerItems).values({instanceId,externalId:item.id,mediaId:id,kind,snapshot:{...item},lastSeenAt:new Date()}).onConflictDoUpdate({target:[providerItems.instanceId,providerItems.externalId],set:{snapshot:{...item},lastSeenAt:new Date()}}).returning();
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
export async function recordMusicListen(tx: Transaction,userId: string,trackId:string,batchId:string,source='coast',occurredAt?:Date,known=true){
  const [event]=await tx.insert(musicListens).values({userId,trackId,batchId,source,occurredAt,occurredAtKnown:known}).onConflictDoNothing().returning();
  if(event) await tx.insert(musicProgress).values({userId,trackId,playCount:1}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{playCount:sql`${musicProgress.playCount}+1`,positionSeconds:0,updatedAt:new Date()}});
  return event;
}
export async function logMusic(userId:string,workId:string,input:unknown){
  const data=v.parse(v.object({batchId:v.pipe(v.string(),v.uuid()),occurredAt:v.optional(v.pipe(v.string(),v.isoTimestamp()))}),input);
  return getDb().transaction(async tx=>{
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
  });
}
export function importedListenBatch(connectionId:string,itemId:string,index:number){const h=createHash('sha256').update(`${connectionId}:${itemId}:${index}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
