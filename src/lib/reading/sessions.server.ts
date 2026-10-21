import { lockFeaturePolicyInTransaction, requireFeature, requireFeatureInTransaction } from '#lib/server/features.js';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '#lib/server/db/index.js';
import { readingSessions, readingProgress, readingWorks, providerConnections, providerInstances, workEditions, users, availability, providerItems } from '#lib/server/db/schema.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { AppError } from '#lib/server/security/errors.js';
import { ProviderActionError } from '#lib/providers/contracts.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { bookFormat } from '#lib/providers/jellyfin/reading.server.js';
import { jellyfinItemKey } from '#lib/providers/jellyfin/paging.js';
import { jellyfinAuthorization } from '#lib/providers/jellyfin/adapter.server.js';
import { instanceFetchConfig } from '#lib/providers/instances.server.js';
import { decryptCredential } from '#lib/server/security/credentials.js';
import { ProviderHttpError, secureProviderFetch } from '#lib/server/security/provider-fetch.js';
import { observeReadingFile } from '#lib/catalogue/reading-files.server.js';
import { updateReading } from '#lib/core/reading/service.server.js';
import { readingCache, readingLease, type ReadingCacheSource } from './cache.server';
import { comicFormats, readingFormats, readingFileLabel, readingLocationSchema, readingPrepareSchema, type ReadingFormat, type ReadingSessionView } from './model';
const uuid=v.pipe(v.string(),v.uuid());
async function work(userId:string,workId:string) {
 v.parse(uuid,userId);v.parse(uuid,workId);
 const [user]=await getDb().select({id:users.id}).from(users).where(and(eq(users.id,userId),eq(users.disabled,false)));if(!user)throw new AppError(401,'Sign in to read.');
 const [item]=await getDb().select().from(readingWorks).where(eq(readingWorks.id,workId));
 if(!item)throw new AppError(404,'Reading work not found.');
 requireEnabledCategory(await requireFeature(userId,'reader'),item.kind);return item;
}
export async function readingConnections(userId:string,workId:string) {
 await work(userId,workId);
 return getDb().select({id:providerConnections.id,name:providerInstances.name}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(providerConnections.userId,userId),eq(providerConnections.status,'connected'),eq(providerInstances.provider,'jellyfin'),eq(providerInstances.enabled,true))).limit(20);
}
/** Saved links are candidates, never an access grant: preparation rechecks the user's source. */
export async function linkedReadingSources(userId:string,workId:string) {
 await work(userId,workId);
 return getDb().select({connectionId:providerConnections.id,externalId:workEditions.externalId,
   name:providerInstances.name,format:workEditions.format})
  .from(workEditions).innerJoin(providerConnections,and(eq(providerConnections.instanceId,workEditions.instanceId),eq(providerConnections.userId,userId)))
  .innerJoin(providerInstances,eq(providerInstances.id,workEditions.instanceId))
  .where(and(eq(workEditions.workId,workId),eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true),
    eq(providerInstances.provider,'jellyfin'),sql`coalesce(${workEditions.metadata}->>'identityConflict','false')<>'true'`,
    inArray(workEditions.format,readingFormats)))
  .orderBy(providerInstances.name,workEditions.id).limit(20);
}
export async function readingSources(userId:string,workId:string,connectionId:string,search:string,offset:number,signal?:AbortSignal) {
 await work(userId,workId);v.parse(uuid,connectionId);
 v.parse(v.pipe(v.string(),v.maxLength(250)),search);v.parse(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(60000)),offset);
 const {adapter,connection}=await getJellyfin(userId,connectionId);
 return adapter.readingLibrary(connection.externalUserId!,search,offset,signal);
}
export function sourceEdition(instanceIdentity:string,book:Awaited<ReturnType<typeof import('#lib/providers/jellyfin/reading.server.js').jellyfinBook>>) {
 // Scope versions to the actual server and item. Titles, editions and page counts are not file identities.
 return new Bun.CryptoHasher('sha256').update(JSON.stringify([instanceIdentity,book.Id.replaceAll('-','').toLowerCase(),book.Etag,book.DateModified,book.Size,book.Path])).digest('hex');
}
/** A normal Read uses a known available link, preferring the last opened edition.
 * Selection grants no access: preparation still verifies the live source. */
async function defaultReadingSources(userId:string,workId:string) {
 const sources=await getDb().select({connectionId:providerConnections.id,externalId:workEditions.externalId,availabilityId:availability.id,verifiedAt:availability.verifiedAt,generation:providerConnections.accountGeneration})
  .from(workEditions).innerJoin(providerConnections,and(eq(providerConnections.instanceId,workEditions.instanceId),eq(providerConnections.userId,userId)))
  .innerJoin(providerInstances,eq(providerInstances.id,workEditions.instanceId))
  .innerJoin(providerItems,and(eq(providerItems.instanceId,workEditions.instanceId),eq(providerItems.mediaId,workId),sql`replace(lower(${providerItems.externalId}),'-','')=replace(lower(${workEditions.externalId}),'-','')`))
  .innerJoin(availability,and(eq(availability.providerItemId,providerItems.id),eq(availability.connectionId,providerConnections.id),eq(availability.userId,userId),eq(availability.mediaId,workId),eq(availability.state,'available')))
  .where(and(eq(workEditions.workId,workId),eq(providerConnections.status,'connected'),eq(providerInstances.provider,'jellyfin'),eq(providerInstances.enabled,true),
   inArray(workEditions.format,readingFormats),sql`coalesce(${workEditions.metadata}->>'identityConflict','false')<>'true'`))
  .orderBy(sql`(${workEditions.metadata}->>'version' = (select s.edition from reading_sessions s where s.user_id=${userId}::uuid and s.work_id=${workId}::uuid order by s.updated_at desc,s.id desc limit 1)) desc nulls last`,desc(availability.verifiedAt),providerInstances.name,workEditions.id).limit(20);
 return sources;
}
export async function prepareReading(userId:string,workId:string,raw:unknown,signal?:AbortSignal):Promise<ReadingSessionView> {
 signal?.throwIfAborted();
 const item=await work(userId,workId),parsed=v.parse(readingPrepareSchema,raw),db=getDb();
 const input=parsed;
 signal?.throwIfAborted();
 let format!:ReadingFormat,edition!:string,connectionId:string|null=null,accountGeneration:string|null=null,externalId:string|null=null;
 if(input.source==='local'){format=input.format;edition=input.edition;}
 else {
  const sources=input.source==='linked'?await defaultReadingSources(userId,workId):[input];
  let selected=false;
  for(const source of sources){
   signal?.throwIfAborted();
   const {connection,instance,adapter}=await getJellyfin(userId,source.connectionId);
   let book;
   try{book=await adapter.readingItem(connection.externalUserId!,source.externalId,signal);}
   catch(cause){
    signal?.throwIfAborted();
    if(input.source!=='linked'||!(cause instanceof ProviderHttpError)||cause.status!==404)throw cause;
    // An exact missing file must not keep advertising Read. Fence the negative
    // observation against reconnects and newer positive observations.
    if('availabilityId' in source)await db.update(availability).set({state:'unknown',verifiedAt:new Date()}).where(and(
     eq(availability.id,source.availabilityId),eq(availability.userId,userId),eq(availability.verifiedAt,source.verifiedAt),
     sql`exists(select 1 from provider_connections c where c.id=${source.connectionId}::uuid and c.user_id=${userId}::uuid and c.account_generation=${source.generation}::uuid and c.status='connected')`));
    continue;
   }
   signal?.throwIfAborted();
   const supported=bookFormat(book);if(!supported)throw new AppError(409,`This file format is not supported. Choose ${readingFileLabel}.`);
   format=supported;edition=sourceEdition(instance.serverIdentity??instance.id,book);connectionId=connection.id;accountGeneration=connection.accountGeneration;externalId=jellyfinItemKey(book.Id);
   await observeReadingFile({userId,workId,connectionId:connection.id,instanceId:instance.id,generation:connection.accountGeneration,book,edition});
   selected=true;break;
  }
  if(!selected)throw new AppError(409,'No readable file is available. Refresh your library and try again.');
 }
 const session=await db.transaction(async tx=>{
  // Reread resets and bookmark copies share one user lock, after provider I/O has finished.
  await lockFeaturePolicyInTransaction(tx,userId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
  signal?.throwIfAborted();
  const [user]=await tx.select({id:users.id}).from(users).where(and(eq(users.id,userId),eq(users.disabled,false)));
  if(!user)throw new AppError(401,'Sign in to read.');
  await requireFeatureInTransaction(tx,userId,'reader');
  await requireFeatureInTransaction(tx,userId,item.kind);
  if(connectionId){
   const [source]=await tx.select({id:providerConnections.id}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.accountGeneration,accountGeneration!),eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true))).for('share');
   if(!source)throw new AppError(410,'Reconnect this reading source.');
  }
  const [previous]=await tx.select({location:readingSessions.location}).from(readingSessions).where(and(eq(readingSessions.userId,userId),eq(readingSessions.workId,workId),eq(readingSessions.edition,edition),eq(readingSessions.format,format))).orderBy(desc(readingSessions.updatedAt)).limit(1);
  signal?.throwIfAborted();
  const [prepared]=await tx.insert(readingSessions).values({userId,workId,format,edition,connectionId,accountGeneration,externalId,location:previous?.location??null,expiresAt:new Date(Date.now()+86400000)}).returning();
  signal?.throwIfAborted();
  return prepared;
 });
 if(signal?.aborted){await db.update(readingSessions).set({closedAt:new Date()}).where(eq(readingSessions.id,session.id));signal.throwIfAborted();}
 return {id:session.id,workId,kind:item.kind,title:item.title,format,edition,location:session.location,source:input.source==='local'?'local':'jellyfin',url:input.source!=='local'?`/api/v1/reading/sessions/${session.id}/file`:null,...(input.source!=='local'&&comicFormats.includes(format as typeof comicFormats[number])?{manifest:`/api/v1/reading/sessions/${session.id}/manifest`}:{})};
}
/** One fresh source context per operation; never retain an access decision between requests. */
async function readingSessionContext(userId:string,id:string) {
 v.parse(uuid,id);
 const [session]=await getDb().select().from(readingSessions).where(and(eq(readingSessions.id,id),eq(readingSessions.userId,userId),isNull(readingSessions.closedAt),gt(readingSessions.expiresAt,new Date()),sql`not exists(select 1 from work_editions e join provider_connections c on c.instance_id=e.instance_id where c.id=${readingSessions.connectionId} and replace(lower(e.external_id),'-','')=replace(lower(${readingSessions.externalId}),'-','') and e.metadata->>'identityConflict'='true')`));
 if(!session)throw new AppError(410,'This reading session has ended.');
 await work(userId,session.workId);
 const jellyfin=session.connectionId?await getJellyfin(userId,session.connectionId):null;
 if(jellyfin&&jellyfin.connection.accountGeneration!==session.accountGeneration)throw new AppError(410,'Reconnect this reading source.');
 return {session,jellyfin};
}
export async function ownedReadingSession(userId:string,id:string) {return (await readingSessionContext(userId,id)).session;}
export async function moveReading(userId:string,id:string,raw:unknown) {
 const session=await ownedReadingSession(userId,id),location=v.parse(readingLocationSchema,raw);
 if(location.format!==session.format||location.format!=='epub'&&location.page>location.total)throw new AppError(400,'Choose a location inside this edition.');
 await getDb().transaction(async tx=>{
  await requireFeatureInTransaction(tx,userId,'reader');
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
 v.parse(uuid,id);
 await getDb().update(readingSessions).set({closedAt:new Date()}).where(and(eq(readingSessions.id,id),eq(readingSessions.userId,userId)));
 await (await readingCache()).release(readingLease(userId,id));return {closed:true};
}
async function remoteReadingContext(userId:string,id:string,signal:AbortSignal) {
 signal.throwIfAborted();
 const {session,jellyfin}=await readingSessionContext(userId,id);
 if(!session.connectionId||!session.externalId||!jellyfin)throw new AppError(404,'Local reading files remain in your browser.');
 const {connection,instance,adapter}=jellyfin;
 const book=await adapter.readingItem(connection.externalUserId!,session.externalId,signal);
 if(bookFormat(book)!==session.format||sourceEdition(instance.serverIdentity??instance.id,book)!==session.edition)throw new AppError(409,'This reading file changed. Open the new edition.');
 return {session,connection,instance,book,adapter};
}
/** Cache reuse never replaces this operation's fresh per-reader source authorization. */
export async function readingDeliverySource(userId:string,id:string,signal:AbortSignal):Promise<ReadingCacheSource> {
 try {
  const {session,connection,instance,book,adapter}=await remoteReadingContext(userId,id,signal);
  if(!await adapter.downloadAllowed(connection.externalUserId!,instance.serverIdentity,signal))throw new AppError(403,'Jellyfin has disabled downloads for this account.');

  if(!comicFormats.includes(session.format as typeof comicFormats[number]))throw new AppError(400,'This format uses its document reader.');
  const credentials=v.parse(v.object({accessToken:v.string()}),JSON.parse(await decryptCredential(connection.credentials!)));
  const config={...await instanceFetchConfig(instance),timeoutMs:20000};
  return {key:JSON.stringify([instance.id,session.externalId,session.edition,session.format]),edition:session.edition,format:session.format as typeof comicFormats[number],bytes:typeof book.Size==='number'&&Number.isSafeInteger(book.Size)&&book.Size>0?book.Size:undefined,
   open:owner=>secureProviderFetch(config,`/Items/${encodeURIComponent(session.externalId!)}/Download`,{headers:{Authorization:jellyfinAuthorization(userId,credentials.accessToken)},signal:owner},{stream:true,maxBytes:Infinity})};
 } catch(cause) {
  if((cause instanceof ProviderActionError && ['identity','permission'].includes(cause.code)) ||
     ((cause instanceof AppError||cause instanceof ProviderHttpError)&&[401,403,404,409,410].includes(cause.status)))(await readingCache()).release(readingLease(userId,id));
  throw cause;
 }
}
export async function streamReading(userId:string,id:string,request:Request) {
 const {session,connection,instance}=await remoteReadingContext(userId,id,request.signal);
 const credentials=v.parse(v.object({accessToken:v.string()}),JSON.parse(await decryptCredential(connection.credentials!)));
 const headers=new Headers({Authorization:jellyfinAuthorization(userId,credentials.accessToken)});
 const range=request.headers.get('range');if(range){if(!/^bytes=\d*-\d*$/.test(range))throw new AppError(400,'Choose one byte range.');headers.set('Range',range);}
 const config={...await instanceFetchConfig(instance),timeoutMs:20000},path=`/Items/${encodeURIComponent(session.externalId!)}/Download`;
 // Reading transfers have no file-size cap; streaming idle/cancellation and access guards remain.
 let response=await secureProviderFetch(config,path,{method:request.method==='HEAD'?'HEAD':'GET',headers,signal:request.signal},{stream:true,maxBytes:Infinity});
 let headSize:string|null=null;
 if(request.method==='HEAD'&&[405,501].includes(response.status)){
  await response.body?.cancel();
  // Jellyfin's download endpoint may expose GET only. Probe one byte, then
  // cancel its body; do not turn a metadata request into a full file download.
  if(!range)headers.set('Range','bytes=0-0');
  response=await secureProviderFetch(config,path,{method:'GET',headers,signal:request.signal},{stream:true,maxBytes:Infinity});
  if(!range&&response.status===206){
   headSize=/^bytes 0-0\/(\d+)$/.exec(response.headers.get('content-range')??'')?.[1]??null;
   if(!headSize){await response.body?.cancel();throw new AppError(502,'Reading file size unavailable.');}
  }
 }
 if(!response.ok&&response.status!==206){await response.body?.cancel();return new Response('Reading file unavailable.',{status:response.status===416?416:502});}
 const outgoing=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':session.format==='pdf'?'application/pdf':'application/octet-stream','Content-Security-Policy':"default-src 'none'; sandbox"});
 for(const key of ['content-length','content-range','accept-ranges','etag','last-modified']){const value=response.headers.get(key);if(value)outgoing.set(key,value);}
 if(headSize){outgoing.set('content-length',headSize);outgoing.delete('content-range');}
 if(request.method==='HEAD'&&!range&&response.status===200)outgoing.delete('content-range');
 if(request.method==='HEAD')await response.body?.cancel();
 return new Response(request.method==='HEAD'?null:response.body,{status:headSize?200:response.status,headers:outgoing});
}
/** Only previously linked files on the viewer's connected servers are considered; no title matching. */
export async function matchingReading(userId:string,workId:string,edition:string) {
 await work(userId,workId);v.parse(v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/)),edition);
 const candidates=await getDb().select({connectionId:providerConnections.id,externalId:workEditions.externalId}).from(workEditions).innerJoin(providerConnections,and(eq(providerConnections.instanceId,workEditions.instanceId),eq(providerConnections.userId,userId))).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(workEditions.workId,workId),sql`${workEditions.metadata}->>'version'=${edition} and coalesce(${workEditions.metadata}->>'identityConflict','false')<>'true'`,eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true))).limit(20);
 for(const candidate of candidates){
  // A library cache never substitutes for this user's permission check.
  try{const session=await prepareReading(userId,workId,{source:'jellyfin',...candidate});if(session.edition===edition)return session;await closeReading(userId,session.id);}catch(cause){if(!(cause instanceof AppError)&&!(cause instanceof Error&&'status' in cause))throw cause;}
 }
 throw new AppError(409,'Open your own copy of the same edition, then join the reading party.');
}

export async function touchReading(userId:string,id:string){await ownedReadingSession(userId,id);(await readingCache()).touch(readingLease(userId,id));await getDb().update(readingSessions).set({updatedAt:new Date()}).where(and(eq(readingSessions.id,id),isNull(readingSessions.closedAt)));return {active:true};}
