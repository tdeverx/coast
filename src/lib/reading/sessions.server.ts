import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { readingSessions, readingProgress, readingWorks, providerConnections, providerInstances, workEditions, users } from '$lib/server/db/schema';
import { getConfig } from '$lib/server/config';
import { requireEnabledCategory } from '$lib/server/experimental';
import { AppError } from '$lib/server/security/errors';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { bookFormat } from '$lib/providers/jellyfin/reading.server';
import { jellyfinAuthorization } from '$lib/providers/jellyfin/adapter.server';
import { instanceFetchConfig } from '$lib/providers/instances.server';
import { decryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';
import { observeReadingFile } from '$lib/catalogue/reading-files.server';
import { updateReading } from '$lib/core/reading/service.server';
import { readingFormats, readingLocationSchema, type ReadingFormat, type ReadingSessionView } from './model';
const uuid=v.pipe(v.string(),v.uuid());
const prepareSchema=v.variant('source',[
 v.strictObject({source:v.literal('local'),format:v.picklist(readingFormats),edition:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/))}),
 v.strictObject({source:v.literal('jellyfin'),connectionId:uuid,externalId:v.pipe(v.string(),v.regex(/^[a-f0-9-]{32,36}$/i))}),
]);
async function work(userId:string,workId:string) {
 v.parse(uuid,userId);v.parse(uuid,workId);
 const [user]=await getDb().select({id:users.id}).from(users).where(and(eq(users.id,userId),eq(users.disabled,false)));if(!user)throw new AppError(401,'Sign in to read.');
 const [item]=await getDb().select().from(readingWorks).where(eq(readingWorks.id,workId));
 if(!item)throw new AppError(404,'Reading work not found.');
 requireEnabledCategory(await getConfig(),item.kind);return item;
}
export async function readingConnections(userId:string,workId:string) {
 await work(userId,workId);
 return getDb().select({id:providerConnections.id,name:providerInstances.name}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(providerConnections.userId,userId),eq(providerConnections.status,'connected'),eq(providerInstances.provider,'jellyfin'),eq(providerInstances.enabled,true))).limit(20);
}
export async function readingSources(userId:string,workId:string,connectionId:string,search:string,offset:number) {
 await work(userId,workId);v.parse(uuid,connectionId);
 v.parse(v.pipe(v.string(),v.maxLength(250)),search);v.parse(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(60000)),offset);
 const {adapter,connection}=await getJellyfin(userId,connectionId);
 return adapter.readingLibrary(connection.externalUserId!,search,offset);
}
export function sourceEdition(instanceIdentity:string,book:Awaited<ReturnType<typeof import('$lib/providers/jellyfin/reading.server').jellyfinBook>>) {
 // Scope versions to the actual server and item. Titles, editions and page counts are not file identities.
 return new Bun.CryptoHasher('sha256').update(JSON.stringify([instanceIdentity,book.Id.replaceAll('-','').toLowerCase(),book.Etag,book.DateModified,book.Size,book.Path])).digest('hex');
}
export async function prepareReading(userId:string,workId:string,raw:unknown):Promise<ReadingSessionView> {
 const item=await work(userId,workId),input=v.parse(prepareSchema,raw),db=getDb();
 let format:ReadingFormat,edition:string,connectionId:string|null=null,accountGeneration:string|null=null,externalId:string|null=null;
 if(input.source==='local'){format=input.format;edition=input.edition;}
 else {
  const {connection,instance,adapter}=await getJellyfin(userId,input.connectionId);
  const book=await adapter.readingItem(connection.externalUserId!,input.externalId);
  const supported=bookFormat(book);if(!supported)throw new AppError(409,'This file format is not supported. Choose PDF, EPUB or CBZ.');
  format=supported;edition=sourceEdition(instance.serverIdentity??instance.id,book);connectionId=connection.id;accountGeneration=connection.accountGeneration;externalId=book.Id;
  await observeReadingFile({userId,workId,connectionId:connection.id,instanceId:instance.id,generation:connection.accountGeneration,book,edition});
 }
 const [previous]=await db.select({location:readingSessions.location}).from(readingSessions).where(and(eq(readingSessions.userId,userId),eq(readingSessions.workId,workId),eq(readingSessions.edition,edition),eq(readingSessions.format,format))).orderBy(desc(readingSessions.updatedAt)).limit(1);
 const [session]=await db.insert(readingSessions).values({userId,workId,format,edition,connectionId,accountGeneration,externalId,location:previous?.location??null,expiresAt:new Date(Date.now()+86400000)}).returning();
 return {id:session.id,workId,title:item.title,format,edition,location:session.location,source:input.source,url:input.source==='jellyfin'?`/api/v1/reading/sessions/${session.id}/file`:null};
}
export async function ownedReadingSession(userId:string,id:string) {
 v.parse(uuid,id);
 const [session]=await getDb().select().from(readingSessions).where(and(eq(readingSessions.id,id),eq(readingSessions.userId,userId),isNull(readingSessions.closedAt),gt(readingSessions.expiresAt,new Date())));
 if(!session)throw new AppError(410,'This reading session has ended.');
 await work(userId,session.workId);
 if(session.connectionId){const {connection}=await getJellyfin(userId,session.connectionId);if(connection.accountGeneration!==session.accountGeneration)throw new AppError(410,'Reconnect this reading source.');}
 return session;
}
export async function moveReading(userId:string,id:string,raw:unknown) {
 const session=await ownedReadingSession(userId,id),location=v.parse(readingLocationSchema,raw);
 if(location.format!==session.format||location.format!=='epub'&&location.page>location.total)throw new AppError(400,'Choose a location inside this edition.');
 await getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
  const saved=await tx.update(readingSessions).set({location,updatedAt:new Date()}).where(and(eq(readingSessions.id,id),isNull(readingSessions.closedAt),gt(readingSessions.expiresAt,new Date()))).returning({id:readingSessions.id});
  if(!saved.length)throw new AppError(410,'This reading session has ended.');
  // Reopening a completed edition does not create a reread. EPUB CFIs also do
  // not overwrite the page count of a user's physical edition.
  const [progress]=await tx.select({state:readingProgress.state}).from(readingProgress).where(and(eq(readingProgress.userId,userId),eq(readingProgress.workId,session.workId)));
  await updateReading(userId,session.workId,location.format==='epub'?{state:!progress||progress.state==='planned'?'reading':progress.state}:{page:location.page,totalPages:location.total},tx);
 });
 return {location};
}
export async function closeReading(userId:string,id:string) {
 await ownedReadingSession(userId,id);
 await getDb().update(readingSessions).set({closedAt:new Date()}).where(eq(readingSessions.id,id));return {closed:true};
}
export async function streamReading(userId:string,id:string,request:Request) {
 const session=await ownedReadingSession(userId,id);
 if(!session.connectionId||!session.externalId)throw new AppError(404,'Local reading files remain in your browser.');
 const {connection,instance,adapter}=await getJellyfin(userId,session.connectionId);
 const book=await adapter.readingItem(connection.externalUserId!,session.externalId);
 if(bookFormat(book)!==session.format||sourceEdition(instance.serverIdentity??instance.id,book)!==session.edition)throw new AppError(409,'This reading file changed. Open the new edition.');
 const credentials=v.parse(v.object({accessToken:v.string()}),JSON.parse(await decryptCredential(connection.credentials!)));
 const headers=new Headers({Authorization:jellyfinAuthorization(userId,credentials.accessToken)});
 const range=request.headers.get('range');if(range){if(!/^bytes=\d*-\d*$/.test(range))throw new AppError(400,'Choose one byte range.');headers.set('Range',range);}
 const response=await secureProviderFetch({...await instanceFetchConfig(instance),timeoutMs:20000},`/Items/${encodeURIComponent(session.externalId)}/Download`,{method:request.method==='HEAD'?'HEAD':'GET',headers,signal:request.signal},{stream:true,maxBytes:512*1024**2});
 if(!response.ok&&response.status!==206){await response.body?.cancel();return new Response('Reading file unavailable.',{status:response.status===416?416:502});}
 const outgoing=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':session.format==='pdf'?'application/pdf':'application/octet-stream','Content-Security-Policy':"default-src 'none'; sandbox"});
 for(const key of ['content-length','content-range','accept-ranges','etag','last-modified']){const value=response.headers.get(key);if(value)outgoing.set(key,value);}
 if(request.method==='HEAD')await response.body?.cancel();
 return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:outgoing});
}
/** Only previously linked files on the viewer's connected servers are considered; no title matching. */
export async function matchingReading(userId:string,workId:string,edition:string) {
 await work(userId,workId);v.parse(v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/)),edition);
 const candidates=await getDb().select({connectionId:providerConnections.id,externalId:workEditions.externalId}).from(workEditions).innerJoin(providerConnections,and(eq(providerConnections.instanceId,workEditions.instanceId),eq(providerConnections.userId,userId))).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(workEditions.workId,workId),sql`${workEditions.metadata}->>'version'=${edition}`,eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true))).limit(20);
 for(const candidate of candidates){
  // A library cache never substitutes for this user's permission check.
  try{const session=await prepareReading(userId,workId,{source:'jellyfin',...candidate});if(session.edition===edition)return session;await closeReading(userId,session.id);}catch(cause){if(!(cause instanceof AppError)&&!(cause instanceof Error&&'status' in cause))throw cause;}
 }
 throw new AppError(409,'Open your own copy of the same edition, then join the reading party.');
}

export async function touchReading(userId:string,id:string){await ownedReadingSession(userId,id);await getDb().update(readingSessions).set({updatedAt:new Date()}).where(and(eq(readingSessions.id,id),isNull(readingSessions.closedAt)));return {active:true};}
