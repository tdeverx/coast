import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '$lib/server/db';
import {availability,providerItems,providerConnections,providerInstances,users,workEditions,readingWorks} from '$lib/server/db/schema';
import {assertJobLease} from '$lib/server/queue/execution';
import {AppError} from '$lib/server/security/errors';
import {bookFormat,type JellyfinBook} from '$lib/providers/jellyfin/reading.server';
/** Shared metadata is an exact file link; access observations always belong to an authenticated user. */
export async function observeReadingFile(input:{userId:string;connectionId:string;instanceId:string;generation:string;workId:string;book:JellyfinBook;edition:string;scanId?:string;access?:boolean}){
 const {userId,connectionId,instanceId,generation,workId,book,edition,scanId}=input,format=bookFormat(book);
 if(!format)return;
 return getDb().transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reading-file:${instanceId}:${book.Id}`},0))`);
  const [account]=await tx.select({connection:providerConnections}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).innerJoin(users,eq(users.id,providerConnections.userId)).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId),eq(providerConnections.accountGeneration,generation),eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true),eq(users.disabled,false))).for('update',{of:providerConnections});
  if(!account)throw new AppError(410,'This connected account changed.');await assertJobLease(tx,true);
  const [work]=await tx.select({kind:readingWorks.kind}).from(readingWorks).where(eq(readingWorks.id,workId));if(!work)throw new AppError(404,'Reading work not found.');
  const [existing]=await tx.select().from(workEditions).where(and(eq(workEditions.instanceId,instanceId),eq(workEditions.externalId,book.Id)));
  if(existing&&existing.workId!==workId)throw new AppError(409,'This file is already linked to another title.');
  await tx.insert(workEditions).values({workId,instanceId,externalId:book.Id,format,metadata:{version:edition}}).onConflictDoUpdate({target:[workEditions.instanceId,workEditions.externalId],set:{format,metadata:{version:edition}}});
  const [previous]=await tx.select().from(providerItems).where(and(eq(providerItems.instanceId,instanceId),eq(providerItems.externalId,book.Id)));
  if(previous&&previous.mediaId!==workId)throw new AppError(409,'This file has conflicting metadata.');
  const [item]=await tx.insert(providerItems).values({instanceId,externalId:book.Id,mediaId:workId,kind:work.kind,snapshot:{format,title:book.Name??'',version:edition}}).onConflictDoUpdate({target:[providerItems.instanceId,providerItems.externalId],set:{snapshot:{format,title:book.Name??'',version:edition},lastSeenAt:new Date()}}).returning();
  if(input.access!==false)await tx.insert(availability).values({userId,connectionId,mediaId:workId,providerItemId:item.id,sourceId:'default',container:format,edition,state:'available',scanId,source:{reading:true},verifiedAt:new Date()}).onConflictDoUpdate({target:[availability.userId,availability.connectionId,availability.providerItemId,availability.sourceId],set:{container:format,edition,state:'available',scanId,verifiedAt:new Date()}});
  return item;
 });
}
