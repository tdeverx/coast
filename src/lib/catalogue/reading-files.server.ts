import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '$lib/server/db';
import {availability,providerItems,providerConnections,providerInstances,users,workEditions,readingWorks,workIdentifiers} from '$lib/server/db/schema';
import {assertJobLease,JobYield} from '$lib/server/queue/execution';
import {AppError} from '$lib/server/security/errors';
import {bookFormat,jellyfinComicVineId,jellyfinOpenLibraryId,type JellyfinBook} from '$lib/providers/jellyfin/reading.server';
import {jellyfinItemKey} from '$lib/providers/jellyfin/paging';
import {readingWorkForEdition} from '$lib/providers/reading.server';
import type {ReadingIdentity} from '$lib/reading/model';
/** Resolve exact references before opening a transaction; edition lookups use the shared provider cache. */
export async function readingFileReference(book:JellyfinBook):Promise<ReadingIdentity|null>{
 const ids=Object.fromEntries(Object.entries(book.ProviderIds).map(([key,value])=>[key.toLowerCase(),value]));
 const comic=jellyfinComicVineId(ids.comicvine);if(comic)return {provider:'comic-vine',externalId:comic};
 const library=jellyfinOpenLibraryId(ids.openlibrary);
 if(library?.endsWith('W'))return {provider:'openlibrary',externalId:library};
 const edition=library??ids.isbn?.replace(/[ -]/g,'').toUpperCase();
 if(!edition||!/^(?:OL[1-9][0-9]{0,19}M|[0-9]{9}[0-9X]|[0-9]{13})$/.test(edition))return null;
 const externalId=await readingWorkForEdition(edition);return externalId?{provider:'openlibrary',externalId}:null;
}
/** Shared metadata is an exact file link; access observations always belong to an authenticated user. */
export async function observeReadingFile(input:{userId:string;connectionId:string;instanceId:string;generation:string;workId:string;book:JellyfinBook;edition:string;scanId?:string;access?:boolean;expectedResetId?:string|null;reference?:ReadingIdentity|null}){
 const {userId,connectionId,instanceId,generation,workId,book,edition,scanId}=input,format=bookFormat(book);
 if(!format)return;
 const reference=input.reference===undefined?await readingFileReference(book):input.reference;
 const key=jellyfinItemKey(book.Id);
 const result=await getDb().transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reading-file:${instanceId}:${key}`},0))`);
  const [account]=await tx.select({connection:providerConnections}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).innerJoin(users,eq(users.id,providerConnections.userId)).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId),eq(providerConnections.accountGeneration,generation),eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true),eq(users.disabled,false))).for('update',{of:providerConnections});
  if(!account)throw new AppError(410,'This connected account changed.');
  if(input.expectedResetId!==undefined&&(account.connection.settings.userSyncResetId??null)!==input.expectedResetId)throw new JobYield();
  await assertJobLease(tx,true);
  const [work]=await tx.select({kind:readingWorks.kind}).from(readingWorks).where(eq(readingWorks.id,workId));if(!work)throw new AppError(404,'Reading work not found.');
  const editions=await tx.select().from(workEditions).where(and(eq(workEditions.instanceId,instanceId),sql`replace(lower(${workEditions.externalId}),'-','')=${key}`)).orderBy(workEditions.id);
  const mappings=await tx.select().from(providerItems).where(and(eq(providerItems.instanceId,instanceId),sql`replace(lower(${providerItems.externalId}),'-','')=${key}`)).orderBy(providerItems.id);
  const identities=reference?await tx.select().from(workIdentifiers).where(sql`(${workIdentifiers.workId}=${workId} and ${workIdentifiers.provider}=${reference.provider}) or (${workIdentifiers.provider}=${reference.provider} and ${workIdentifiers.externalId}=${reference.externalId} and ${workIdentifiers.kind} in ('book','comic'))`):[];
  const conflict=editions.some(row=>row.workId!==workId)||mappings.some(row=>row.mediaId!==workId)||!!reference&&(
   identities.some(row=>row.workId!==workId&&row.externalId===reference.externalId)||identities.some(row=>row.workId===workId)&&!identities.some(row=>row.workId===workId&&row.externalId===reference.externalId))
   ||editions.some(row=>row.metadata.identityConflict===true)&&(!reference||!identities.some(row=>row.workId===workId&&row.externalId===reference.externalId));
  if(conflict){
   // Commit the quarantine, then report the conflict. Throwing inside this
   // transaction would roll back the hold and leave the stale file playable.
   for(const item of mappings)await tx.update(availability).set({state:'unknown',source:sql`${availability.source} || '{"reading":true,"identityConflict":true}'::jsonb`,verifiedAt:new Date()}).where(eq(availability.providerItemId,item.id));
   for(const edition of editions)await tx.update(workEditions).set({metadata:sql`${workEditions.metadata} || '{"identityConflict":true}'::jsonb`}).where(eq(workEditions.id,edition.id));
   return {conflict:true as const};
  }
  const existing=editions[0],previous=mappings[0];
  const editionMetadata={version:edition,identityConflict:false};
  if(existing)await tx.update(workEditions).set({format,metadata:editionMetadata}).where(eq(workEditions.id,existing.id));
  else await tx.insert(workEditions).values({workId,instanceId,externalId:key,format,metadata:editionMetadata});
  const snapshot={format,title:book.Name??'',version:edition};
  const [item]=previous?await tx.update(providerItems).set({snapshot,lastSeenAt:new Date()}).where(eq(providerItems.id,previous.id)).returning():await tx.insert(providerItems).values({instanceId,externalId:key,mediaId:workId,kind:work.kind,snapshot,lastSeenAt:new Date()}).returning();
  if(input.access!==false)await tx.insert(availability).values({userId,connectionId,mediaId:workId,providerItemId:item.id,sourceId:'default',container:format,edition,state:'available',scanId,source:{reading:true,identityConflict:false},verifiedAt:new Date()}).onConflictDoUpdate({target:[availability.userId,availability.connectionId,availability.providerItemId,availability.sourceId],set:{container:format,edition,state:'available',scanId,source:{reading:true,identityConflict:false},verifiedAt:new Date()}});
  return {item};
 });
 if('conflict' in result)throw new AppError(409,'This file has conflicting title identifiers. Correct its Jellyfin metadata and rescan before reading.','reading_identity_conflict');
 return result.item;
}
