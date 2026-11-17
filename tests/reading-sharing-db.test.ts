import {beforeAll,afterAll,expect,test,spyOn} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {AppError} from '../src/lib/server/security/errors';
import * as connections from '../src/lib/providers/jellyfin/connection.server';
import * as transport from '../src/lib/server/security/provider-fetch';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import * as cacheModule from '../src/lib/reading/cache.server';
import {createReadingCache,type ReadingCacheEntry} from '../src/lib/reading/cache.server';
import {observeReadingFile} from '../src/lib/catalogue/reading-files.server';
import {sourceEdition,prepareReading,moveReading,ownedReadingSession,streamReading,closeReading} from '../src/lib/reading/sessions.server';
import {updateReading} from '../src/lib/core/reading/service.server';
import {workActionData} from '../src/lib/collection/query.server';
import {presence} from '../src/lib/social/presence.server';
import {createShare,claimShare,revokeShare,sharedState} from '../src/lib/sharing/service.server';
import {startSharedReading,sharedReadingResource,touchSharedReading,closeSharedReading,expireSharedReadingViewers} from '../src/lib/sharing/reading.server';
import {copySharePath,listActiveShares} from '../src/lib/sharing/links.server';
import type {SessionUser} from '../src/lib/server/auth';
import type {JellyfinBook} from '../src/lib/providers/jellyfin/reading.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const [owner,other,book,comic,instance,connection,generation]=Array.from({length:7},()=>crypto.randomUUID());
const pdf='a'.repeat(32),archive='b'.repeat(32);
const actor:SessionUser={id:owner,username:'reading-link-owner',email:null,role:'admin',settings:{}};
const files:Record<string,JellyfinBook>={
 [pdf]:{Id:pdf,Type:'Book',Name:'Private document',Path:'/private/file.pdf',Etag:'v1',Size:4,ProviderIds:{}},
 [archive]:{Id:archive,Type:'Book',Name:'Private archive',Path:'/private/file.cbz',Etag:'v1',Size:4,ProviderIds:{}},
};
let allowed=true,downloads=true,directory:string,afterFetch:(()=>Promise<void>)|undefined,pageHook:(()=>Promise<void>)|undefined;
let beforeItem:(()=>Promise<void>)|undefined,bodyFactory:(()=>ReadableStream<Uint8Array>)|undefined;
let fetches=0,releases=0;
let restoreAccount:(()=>void)|undefined,restoreFetch:(()=>void)|undefined,restoreCache:(()=>void)|undefined;
const adapter=new JellyfinAdapter(async path=>{
 if(path==='/System/Info/Public')return {Id:instance,ProductName:'Jellyfin Server',ServerName:'Fixture',Version:'10.11.0'};
 if(path==='/Users/Me')return {Id:'fixture-reader',ServerId:instance,Policy:{IsDisabled:false,EnableContentDownloading:downloads}};
 if(!allowed)throw new AppError(403,'File access denied.');
 const id=Object.keys(files).find(id=>path.includes(id));if(id){await beforeItem?.();return files[id];}
 throw new Error('Unexpected fixture request '+path);
},owner,'private-source-token');
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb(),config=await getConfig();directory=await mkdtemp(join(tmpdir(),'coast-reading-share-'));
 await Bun.write(join(directory,'page.png'),'page');
 const value={...config,experimentalBooks:true,experimentalComics:true,allowPlaybackSharing:true};
 await db.insert(s.systemSettings).values({key:'coast',value}).onConflictDoUpdate({target:s.systemSettings.key,set:{value}});
 await db.insert(s.users).values([{id:owner,username:actor.username,role:'admin'},{id:other,username:'reading-link-other'}]);
 await db.insert(s.providerInstances).values({id:instance,provider:'jellyfin',name:'Reading source',baseUrl:'https://fixture.invalid',serverIdentity:instance});
 await db.insert(s.providerConnections).values({id:connection,userId:owner,instanceId:instance,accountGeneration:generation,externalUserId:'fixture-reader',credentials:await encryptCredential(JSON.stringify({accessToken:'private-source-token'}))});
 await db.insert(s.works).values([{id:book,category:'book',kind:'book'},{id:comic,category:'comic',kind:'comic'}]);
 await db.insert(s.readingWorks).values([{id:book,kind:'book',provider:'openlibrary',externalId:'OL192837W',title:'Document',sourceUrl:'https://fixture.invalid'},
  {id:comic,kind:'comic',provider:'comic-vine',externalId:'4000-192837',title:'Comic',sourceUrl:'https://fixture.invalid'}]);
 for(const [workId,id] of [[book,pdf],[comic,archive]])await observeReadingFile({userId:owner,workId,connectionId:connection,instanceId:instance,generation,book:files[id],edition:sourceEdition(instance,files[id]),reference:null});
 const original=connections.getJellyfin;
 const accountSpy=spyOn(connections,'getJellyfin').mockImplementation(async(user,id)=>({...await original(user,id),adapter}));restoreAccount=()=>accountSpy.mockRestore();
 const fetchSpy=spyOn(transport,'secureProviderFetch').mockImplementation(async(_config,_path,init)=>{
  fetches++;expect(new Headers(init?.headers).get('authorization')).toContain('private-source-token');
  await afterFetch?.();return new Response(bodyFactory?.()??'%PDF',{status:206,headers:{'content-range':'bytes 0-3/4','content-length':'4','accept-ranges':'bytes'}});
 });restoreFetch=()=>fetchSpy.mockRestore();
 const actual=createReadingCache(join(directory,'cache'),'/unused');
 const cacheSpy=spyOn(cacheModule,'readingCache').mockResolvedValue({...actual,
  async acquire(_lease,source){
   const entry:ReadingCacheEntry={controller:new AbortController(),directory,leases:new Map(),listeners:new Set(),pages:new Map(),
    manifest:{version:1,edition:source.edition,format:source.format,pages:[{width:1,height:1,bytes:4}]},progress:{phase:'prepare'},finished:true,reserved:0,metadataBytes:0,job:Promise.resolve(),changed:0};
   return entry;
  },claim(){return async()=>{releases++;};},touch(){},async release(){releases++;},
  async page(){await pageHook?.();return {path:join(directory,'page.png'),mime:'image/png',bytes:4};},
 });restoreCache=()=>cacheSpy.mockRestore();
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 restoreAccount?.();restoreFetch?.();restoreCache?.();
 await getDb().delete(s.users).where(inArray(s.users.id,[owner,other]));
 await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id,instance));
 await getDb().delete(s.works).where(inArray(s.works.id,[book,comic]));
 await rm(directory,{recursive:true,force:true});
});
async function invite(workId=book){const share=await createShare(actor,{workId,connectionId:connection,hours:1});const viewer=await claimShare({token:share.token},null);return {share,token:viewer.token};}

run('reading capabilities isolate sessions, bookmarks, progress and presence, with normal owner APIs fenced',async()=>{
 const saved=await prepareReading(owner,book,{source:'local',format:'pdf',edition:sourceEdition(instance,files[pdf])});
 const location={format:'pdf' as const,page:3,total:8};await moveReading(owner,saved.id,location);await closeReading(owner,saved.id);
 const before=(await getDb().select().from(s.readingProgress).where(eq(s.readingProgress.userId,owner)))[0];
 const historyBefore=await getDb().select().from(s.readingHistory).where(eq(s.readingHistory.userId,owner)).orderBy(s.readingHistory.id);
 const {share,token}=await invite();expect((await sharedState(token)).mediaType).toBe('reading');
 const shared=await startSharedReading(token,{});expect(shared).toMatchObject({shared:true,location:null,source:'jellyfin',url:`/api/share/reading/${shared.id}/file`});
 const concurrent=await Promise.allSettled([startSharedReading(token,{}),startSharedReading(token,{})]);
 expect(concurrent.some(result=>result.status==='fulfilled')).toBe(true);
 for(const result of concurrent)if(result.status==='fulfilled')expect(result.value.id).toBe(shared.id);
 expect(await getDb().select().from(s.readingSessions).where(and(eq(s.readingSessions.shareId,share.id),eq(s.readingSessions.userId,owner)))).toHaveLength(1);
 expect(JSON.stringify(shared)).not.toMatch(/private-source-token|\/private\/|fixture-reader|connectionId/);
 expect((await startSharedReading(token,{})).id).toBe(shared.id);
 await expect(ownedReadingSession(owner,shared.id)).rejects.toMatchObject({status:410});
 await expect(moveReading(owner,shared.id,location)).rejects.toMatchObject({status:410});
 await expect(closeReading(owner,shared.id)).rejects.toMatchObject({status:410});
 await expect(streamReading(owner,shared.id,new Request('http://coast/file'))).rejects.toMatchObject({status:410});
 expect(await presence(owner)).toEqual([]);
 expect((await getDb().select().from(s.readingProgress).where(eq(s.readingProgress.userId,owner)))[0]).toEqual(before);
 expect((await workActionData(owner,book)).reading?.hasBookmark).toBe(true);
 await touchSharedReading(token,shared.id);
 const response=await sharedReadingResource(token,shared.id,'file',new Request('http://coast/file',{headers:{range:'bytes=0-3'}}));
 expect(response.status).toBe(206);expect(await response.text()).toBe('%PDF');expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(await getDb().select().from(s.readingHistory).where(eq(s.readingHistory.userId,owner)).orderBy(s.readingHistory.id)).toEqual(historyBefore);
 expect((await listActiveShares(actor)).find(link=>link.id===share.id)?.viewers).toBe(1);
 expect((await copySharePath(actor,share.id)).path).toContain(share.token);
 const foreign=await invite();await expect(sharedReadingResource(foreign.token,shared.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:410});
 const resumed=await prepareReading(owner,book,{source:'local',format:'pdf',edition:sourceEdition(instance,files[pdf])});expect(resumed.location).toEqual(location);await closeReading(owner,resumed.id);
 await updateReading(owner,book,{reset:'position'});
 expect((await getDb().select().from(s.readingSessions).where(eq(s.readingSessions.id,shared.id)))[0].closedAt).toBeNull();
 await closeSharedReading(token,shared.id);
 expect((await getDb().select().from(s.readingSessions).where(eq(s.readingSessions.id,shared.id)))[0].closedAt).not.toBeNull();
});

run('reading links enforce explicit source grants, website-only options, downloads and fresh owner lifetime',async()=>{
 await expect(createShare({...actor,id:other,role:'admin'},{workId:book,connectionId:connection})).rejects.toThrow();
 await expect(createShare(actor,{workId:book,connectionId:connection,trackProgress:true})).rejects.toMatchObject({status:400});
 await expect(createShare(actor,{workId:book,connectionId:connection,autoRevoke:true})).rejects.toMatchObject({status:400});
 downloads=false;await expect(createShare(actor,{workId:book,connectionId:connection})).rejects.toMatchObject({status:403});downloads=true;
 const {share,token}=await invite(),session=await startSharedReading(token,{});
 const previous=fetches;downloads=false;await expect(sharedReadingResource(token,session.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:403});downloads=true;expect(fetches).toBe(previous);
 afterFetch=async()=>{downloads=false;};
 await expect(sharedReadingResource(token,session.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:403});afterFetch=undefined;downloads=true;
 files[pdf].Etag='v2';await expect(sharedReadingResource(token,session.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:409});files[pdf].Etag='v1';
 allowed=false;await expect(sharedReadingResource(token,session.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:403});allowed=true;
 await getDb().update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,connection));
 await expect(touchSharedReading(token,session.id)).rejects.toMatchObject({status:410});
 await getDb().update(s.providerConnections).set({accountGeneration:generation}).where(eq(s.providerConnections.id,connection));
 await getDb().update(s.playbackShares).set({expiresAt:new Date(Date.now()-1)}).where(eq(s.playbackShares.id,share.id));
 await expect(sharedReadingResource(token,session.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:410});
});

run('stale guest close and expiry sweep cannot retire a successor or a renewed viewer',async()=>{
 const db=getSql(),invitation=await invite(),first=await startSharedReading(invitation.token,{});
 const [viewer]=await db<{id:string}[]>`select id from share_viewers where reading_session_id=${first.id}`;
 const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};};
 async function waitForCloseLock(){
  for(let attempts=0;attempts<100;attempts++){
   const [row]=await db<{blocked:boolean}[]>`select exists(select 1 from pg_stat_activity where datname=current_database()
    and query like '%/* reading-share-close */%' and wait_event_type='Lock' and pid<>pg_backend_pid()) as blocked`;
   if(row.blocked)return;
  }
  throw new Error('Guest close did not reach its row-lock fence.');
 }
 const locked=deferred(),release=deferred(),successor=crypto.randomUUID();
 const replacement=db.begin(async tx=>{
  await tx`select id from share_viewers where id=${viewer.id} for update`;locked.resolve();await release.promise;
  await tx`update reading_sessions set closed_at=now() where id=${first.id}`;
  await tx`insert into reading_sessions(id,user_id,work_id,share_id,share_viewer_id,connection_id,account_generation,external_id,format,edition,expires_at)
   select ${successor},user_id,work_id,share_id,share_viewer_id,connection_id,account_generation,external_id,format,edition,expires_at from reading_sessions where id=${first.id}`;
  await tx`update share_viewers set reading_session_id=${successor},last_seen_at=now() where id=${viewer.id}`;
 });
 await locked.promise;const stale=closeSharedReading(invitation.token,first.id);
 try{await waitForCloseLock();}finally{release.resolve();}
 await replacement;await stale;
 expect((await db`select closed_at from reading_sessions where id=${successor}`)[0].closed_at).toBeNull();
 expect((await db`select reading_session_id from share_viewers where id=${viewer.id}`)[0].reading_session_id).toBe(successor);
 await db`update share_viewers set last_seen_at=now()-interval '2 minutes' where id=${viewer.id}`;
 const held=deferred(),renew=deferred();
 const renewal=db.begin(async tx=>{
  await tx`select id from share_viewers where id=${viewer.id} for update`;held.resolve();await renew.promise;
  await tx`update share_viewers set last_seen_at=now() where id=${viewer.id}`;
 });
 await held.promise;const expiring=expireSharedReadingViewers();
 try{await waitForCloseLock();}finally{renew.resolve();}
 await renewal;await expiring;
 expect((await db`select closed_at from reading_sessions where id=${successor}`)[0].closed_at).toBeNull();
 await closeSharedReading(invitation.token,successor);
});

run('warm comic resources and delayed file headers reauthorize revocation before publishing, closing guest leases',async()=>{
 const comicInvite=await invite(comic),session=await startSharedReading(comicInvite.token,{});
 expect(session.manifest).toBe(`/api/share/reading/${session.id}/manifest`);
 const manifest=await sharedReadingResource(comicInvite.token,session.id,'manifest',new Request('http://coast/manifest'));
 expect(await manifest.text()).toContain('"manifest"');
 const page=await sharedReadingResource(comicInvite.token,session.id,'pages',new Request('http://coast/page'),'0');expect(await page.text()).toBe('page');
 pageHook=()=>revokeShare(actor,comicInvite.share.id);
 await expect(sharedReadingResource(comicInvite.token,session.id,'pages',new Request('http://coast/page'),'0')).rejects.toMatchObject({status:410});pageHook=undefined;
 expect(releases).toBeGreaterThan(0);
 const {share,token}=await invite(),document=await startSharedReading(token,{});
 afterFetch=()=>revokeShare(actor,share.id);
 await expect(sharedReadingResource(token,document.id,'file',new Request('http://coast/file'))).rejects.toMatchObject({status:410});afterFetch=undefined;
 expect((await getDb().select().from(s.readingSessions).where(eq(s.readingSessions.id,document.id)))[0].closedAt).not.toBeNull();
 expect(await getSql()`select id from share_request_leases where reading_id=${document.id}`).toHaveLength(0);
});

run('aborted duplicate preparation preserves an existing reader and a stale heartbeat cannot renew its successor',async()=>{
 const invitation=await invite(),session=await startSharedReading(invitation.token,{}),db=getSql();
 const abort=new AbortController();beforeItem=async()=>{abort.abort();};
 try{await expect(startSharedReading(invitation.token,{},abort.signal)).rejects.toThrow();}finally{beforeItem=undefined;}
 expect((await db`select ended_at,reading_session_id from share_viewers where reading_session_id=${session.id}`)[0]).toMatchObject({ended_at:null,reading_session_id:session.id});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(yes=>{entered=yes;}),held=new Promise<void>(yes=>{release=yes;});
 beforeItem=async()=>{entered();await held;};
 const heartbeat=touchSharedReading(invitation.token,session.id);
 await started;beforeItem=undefined;
 await closeSharedReading(invitation.token,session.id);
 const successor=await startSharedReading(invitation.token,{});release();
 await expect(heartbeat).rejects.toMatchObject({status:410});
 expect((await db`select ended_at,reading_session_id from share_viewers where reading_session_id=${successor.id}`)[0]).toMatchObject({ended_at:null,reading_session_id:successor.id});
 await closeSharedReading(invitation.token,successor.id);
});

run('revocation cancels pending bytes and unconsumed reading responses immediately',async()=>{
 const invitation=await invite(),session=await startSharedReading(invitation.token,{});
 let entered!:()=>void,release!:()=>void,cancelled=false;
 const started=new Promise<void>(yes=>{entered=yes;}),held=new Promise<void>(yes=>{release=yes;});
 bodyFactory=()=>new ReadableStream<Uint8Array>({async pull(target){entered();await held;if(!cancelled){target.enqueue(new TextEncoder().encode('%PDF'));target.close();}},cancel(){cancelled=true;}});
 try{
  const response=await sharedReadingResource(invitation.token,session.id,'file',new Request('http://coast/file'));
  await started;const reading=response.text().then(value=>({value,error:null}),error=>({value:null,error}));await revokeShare(actor,invitation.share.id);release();
  expect((await reading).error).not.toBeNull();expect(cancelled).toBe(true);
 }finally{bodyFactory=undefined;release();}
 const next=await invite(),otherSession=await startSharedReading(next.token,{});let unconsumedCancelled=false;
 bodyFactory=()=>new ReadableStream<Uint8Array>({start(target){target.enqueue(new TextEncoder().encode('%PDF'));},cancel(){unconsumedCancelled=true;}});
 try{
  const response=await sharedReadingResource(next.token,otherSession.id,'file',new Request('http://coast/file'));
  await revokeShare(actor,next.share.id);
  expect(unconsumedCancelled).toBe(true);await expect(response.text()).rejects.toThrow();
 }finally{bodyFactory=undefined;}
});
