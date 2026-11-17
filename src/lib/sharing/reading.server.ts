import * as v from 'valibot';
import {getSql} from '#lib/server/db/index.js';
import {AppError} from '#lib/server/security/errors.js';
import {readingShareSource,streamReading} from '#lib/reading/sessions.server.js';
import {readingManifest,readingPage} from '#lib/reading/delivery.server.js';
import {readingCache,readingLease} from '#lib/reading/cache.server.js';
import {comicFormats,type ReadingFormat,type ReadingSessionView} from '#lib/reading/model.js';
import {shareViewer,assertShare} from './service.server';
import {reserveViewer,releaseViewer} from './leases.server';
import {withSharedRequest} from './request-leases.server';

const uuid=v.pipe(v.string(),v.uuid());
const transfers=new Map<string,Set<AbortController>>();
type Session={id:string;format:ReadingFormat;edition:string};
function view(viewer:Awaited<ReturnType<typeof shareViewer>>,session:Session):ReadingSessionView{
 return {id:session.id,workId:viewer.work_id,kind:viewer.kind,title:viewer.title,format:session.format,
  edition:session.edition,source:'jellyfin',shared:true,location:null,url:`/api/share/reading/${session.id}/file`,
  ...(comicFormats.includes(session.format as typeof comicFormats[number])?{manifest:`/api/share/reading/${session.id}/manifest`}:{})};
}
function reading(viewer:Awaited<ReturnType<typeof shareViewer>>){
 if(!['book','comic'].includes(viewer.kind))throw new AppError(400,'This invitation is not a reading link.');
}

/** One fixed file and one active session per viewer. Provider I/O holds no database locks. */
export async function startSharedReading(token:string|undefined,input:unknown,signal?:AbortSignal){
 v.parse(v.strictObject({}),input);signal?.throwIfAborted();
 const viewer=await shareViewer(token);reading(viewer);
 await reserveViewer(viewer.owner_id,viewer.viewer_id,true);
 const db=getSql(),preparation=crypto.randomUUID();
 const [lease]=await db`update share_viewers set preparing_until=now()+interval '2 minutes',preparation_token=${preparation}
  where id=${viewer.viewer_id} and (preparing_until is null or preparing_until<now()) returning id`;
 if(!lease)throw new AppError(409,'Reading is already preparing.');
 let created:string|undefined;
 try{
  const source=await readingShareSource(viewer.owner_id,viewer.work_id,viewer.connection_id,viewer.source_id,signal);
  if(source.connection.accountGeneration!==viewer.account_generation||source.edition!==viewer.edition||source.externalId!==viewer.source_id)throw new AppError(410,'The shared edition has changed.');
  signal?.throwIfAborted();
  const session=await db.begin(async tx=>{
   const [current]=await tx`select s.*,v.reading_session_id from share_viewers v join playback_shares s on s.id=v.share_id
    where v.id=${viewer.viewer_id} and v.preparation_token=${preparation} and v.preparing_until>now() for update of v,s`;
   if(!current)throw new AppError(409,'Reading preparation was superseded.');
   await assertShare(current,tx);
   const [existing]=current.reading_session_id?await tx<Session[]>`select id,format,edition from reading_sessions where id=${current.reading_session_id}
    and share_id=${viewer.id} and share_viewer_id=${viewer.viewer_id} and closed_at is null and expires_at>now()`:[];
   if(existing)return existing;
   await tx`update reading_sessions set closed_at=now() where share_viewer_id=${viewer.viewer_id} and closed_at is null`;
   signal?.throwIfAborted();
   const [row]=await tx<Session[]>`insert into reading_sessions(user_id,work_id,share_id,share_viewer_id,connection_id,account_generation,external_id,format,edition,expires_at)
    values(${viewer.owner_id},${viewer.work_id},${viewer.id},${viewer.viewer_id},${viewer.connection_id},${viewer.account_generation},${viewer.source_id},${source.format},${source.edition},${viewer.expires_at}) returning id,format,edition`;
   await tx`update share_viewers set reading_session_id=${row.id},ended_at=null,last_seen_at=now() where id=${viewer.viewer_id}`;
   created=row.id;return row;
  });
  await assertShare(viewer);signal?.throwIfAborted();
  return view(viewer,session);
 }catch(cause){
  if(created)await closeSharedReadingViewer(viewer.owner_id,viewer.viewer_id,created);
  else if(viewer.reading_session_id){if(!signal?.aborted)await closeSharedReadingViewer(viewer.owner_id,viewer.viewer_id,viewer.reading_session_id);}
  else await releaseViewer(viewer.owner_id,viewer.viewer_id);
  throw cause;
 }finally{await db`update share_viewers set preparing_until=null,preparation_token=null where id=${viewer.viewer_id} and preparation_token=${preparation}`;}
}

async function context(token:string|undefined,id:string){
 v.parse(uuid,id);const viewer=await shareViewer(token);reading(viewer);
 const [session]=await getSql()`select id from reading_sessions where id=${id} and id=${viewer.reading_session_id}
  and share_id=${viewer.id} and share_viewer_id=${viewer.viewer_id} and user_id=${viewer.owner_id}
  and work_id=${viewer.work_id} and connection_id=${viewer.connection_id} and account_generation=${viewer.account_generation}
  and external_id=${viewer.source_id} and edition=${viewer.edition} and closed_at is null and expires_at>now()`;
 if(!session)throw new AppError(410,'This reading invitation session has ended.');
 return viewer;
}

async function closeSharedReadingViewer(ownerId:string,viewerId:string,expectedSessionId?:string,onlyExpired=false){
 const db=getSql(),rows=await db.begin(async tx=>{
  const [viewer]=await tx<{reading_session_id:string}[]>`/* reading-share-close */ select v.reading_session_id from share_viewers v
   join playback_shares s on s.id=v.share_id join reading_sessions r on r.id=v.reading_session_id
   where v.id=${viewerId} and s.owner_id=${ownerId} and (${expectedSessionId??null}::uuid is null or v.reading_session_id=${expectedSessionId??null}::uuid)
    and (${!onlyExpired} or v.ended_at is not null or v.last_seen_at<now()-interval '90 seconds'
      or s.revoked_at is not null or s.expires_at<=now() or r.closed_at is not null or r.expires_at<=now()) for update of v`;
  if(!viewer)return [];
  const closed=await tx<{id:string}[]>`update reading_sessions set closed_at=coalesce(closed_at,now())
   where id=${viewer.reading_session_id} and user_id=${ownerId} and share_viewer_id=${viewerId} returning id`;
  await tx`update share_viewers set reading_session_id=null,ended_at=now(),desired_bitrate=null
   where id=${viewerId} and reading_session_id=${viewer.reading_session_id}`;
  return closed;
 });
 for(const row of rows){
  for(const controller of transfers.get(row.id)??[])controller.abort(new DOMException('Reading invitation ended.','AbortError'));
  await (await readingCache()).release(readingLease(ownerId,row.id));
 }
}
export async function closeReadingShare(ownerId:string,id:string){
 const viewers=await getSql()<{id:string}[]>`select v.id from share_viewers v join playback_shares s on s.id=v.share_id
  where s.id=${id} and s.owner_id=${ownerId} and v.reading_session_id is not null order by v.id limit 64`;
 for(let offset=0;offset<viewers.length;offset+=2)await Promise.all(viewers.slice(offset,offset+2).map(viewer=>closeSharedReadingViewer(ownerId,viewer.id)));
}
export async function expireSharedReadingViewers(ownerId?:string){
 const db=getSql(),rows=await db`select v.id,v.reading_session_id,s.owner_id from share_viewers v join playback_shares s on s.id=v.share_id
  join reading_sessions r on r.id=v.reading_session_id where (${ownerId??null}::uuid is null or s.owner_id=${ownerId??null}::uuid)
   and (v.ended_at is not null or v.last_seen_at<now()-interval '90 seconds' or s.revoked_at is not null or s.expires_at<=now() or r.closed_at is not null or r.expires_at<=now())
  order by v.last_seen_at,v.id limit 20`;
 for(const row of rows)await closeSharedReadingViewer(row.owner_id,row.id,row.reading_session_id,true);
}
export async function closeSharedReading(token:string|undefined,id:string){
 const viewer=await context(token,id);await closeSharedReadingViewer(viewer.owner_id,viewer.viewer_id,id);return {closed:true};
}
export async function touchSharedReading(token:string|undefined,id:string,signal?:AbortSignal){
 const viewer=await context(token,id);
 const source=await readingShareSource(viewer.owner_id,viewer.work_id,viewer.connection_id,viewer.source_id,signal);
 if(source.edition!==viewer.edition||source.connection.accountGeneration!==viewer.account_generation)throw new AppError(410,'The shared edition has changed.');
 await assertShare(viewer);await reserveViewer(viewer.owner_id,viewer.viewer_id,false,id);
 const changed=await getSql()`update reading_sessions set updated_at=now() where id=${id} and closed_at is null and expires_at>now() returning id`;
 if(!changed.length)throw new AppError(410,'This reading invitation session has ended.');
 (await readingCache()).touch(readingLease(viewer.owner_id,id));return {active:true};
}

/** The same owner allocation and per-viewer dispatch budget also cover document transfers. */
export async function sharedReadingResource(token:string|undefined,id:string,resource:string,request:Request,index?:string){
 const viewer=await context(token,id);await reserveViewer(viewer.owner_id,viewer.viewer_id,false,id);
 const active=transfers.get(id)??new Set<AbortController>();
 if(active.size>=8)throw new AppError(429,'Too many reading requests.');
 const controller=new AbortController();active.add(controller);transfers.set(id,active);
 let body:ReadableStreamDefaultReader<Uint8Array>|undefined,output:ReadableStreamDefaultController<Uint8Array>|undefined,signal:AbortSignal|undefined;
 const timer=setTimeout(()=>controller.abort(new DOMException('Reading invitation expired.','AbortError')),Math.max(1,new Date(viewer.expires_at).getTime()-Date.now()));
 const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);active.delete(controller);if(!active.size)transfers.delete(id);};
 const aborted=()=>{cleanup();void body?.cancel(signal?.reason).catch(()=>{});try{output?.error(signal?.reason);}catch{/* Already settled. */}};
 try{
  signal=AbortSignal.any([request.signal,controller.signal]);signal.addEventListener('abort',aborted,{once:true});
  const linked=new Request(request,{signal});
  const response=await withSharedRequest(viewer.owner_id,viewer.viewer_id,id,linked,async authorized=>{
   if(resource==='file')return streamReading(viewer.owner_id,id,authorized,viewer.id);
   if(resource==='manifest')return readingManifest(viewer.owner_id,id,authorized,viewer.id);
   if(resource==='pages'&&index!==undefined)return readingPage(viewer.owner_id,id,index,authorized,viewer.id);
   throw new AppError(404,'Reading resource not found.');
  },'reading');
  if(!response.body){cleanup();return response;}
  body=response.body.getReader();
  if(signal.aborted){aborted();throw signal.reason;}
  const incoming=body;
  return new Response(new ReadableStream<Uint8Array>({
   start(target){output=target;},
   async pull(target){try{linked.signal.throwIfAborted();const next=await incoming.read();linked.signal.throwIfAborted();if(next.done){cleanup();target.close();}else target.enqueue(next.value);}catch(cause){cleanup();void incoming.cancel().catch(()=>{});try{target.error(cause);}catch{/* Abort already settled the reader. */}}},
   async cancel(){controller.abort();cleanup();await incoming.cancel().catch(()=>{});},
  }),{status:response.status,headers:{...Object.fromEntries(response.headers),'referrer-policy':'no-referrer'}});
 }catch(cause){cleanup();if(controller.signal.aborted&&!request.signal.aborted)throw new AppError(410,'This reading invitation has expired or was revoked.');throw cause;}
}
