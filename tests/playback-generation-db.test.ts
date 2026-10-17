import {beforeAll,beforeEach,afterAll,test,expect,spyOn} from 'bun:test';
import {getDb,getSql} from '../src/lib/server/db';
import {ProviderQueueBusyError,providerRequestLimits,queueProviderRequest,requestPriority} from '../src/lib/server/security/request-priority';
import {handler} from '../src/lib/server/api/index.server';
import {getConfig,type CoastConfig} from '../src/lib/server/config';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {startPlayback,progressPlayback,streamPlayback} from '../src/lib/playback/service.server';
import {executeJellyfinScrobble} from '../src/lib/sync/jellyfin.server';
import {createRoom} from '../src/lib/playback/synced/service.server';
import * as connections from '../src/lib/providers/jellyfin/connection.server';
import * as queries from '../src/lib/server/queries/media';
import * as transport from '../src/lib/server/security/provider-fetch';
import type {PlaybackSource} from '../src/lib/providers/contracts';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID(),movie=crypto.randomUUID(),track=crypto.randomUUID();
const browser={containers:['mp4','m4a'],videoCodecs:['h264'],audioCodecs:['aac'],nativeHls:false,hlsJs:true};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};};
let config:CoastConfig,credential:string,onInfo:(signal?:AbortSignal)=>Promise<void>=async()=>{},onPresentation:()=>Promise<void>=async()=>{};
let onIdentity:(signal?:AbortSignal)=>Promise<void>=async()=>{};
let infos=0,relays=0,scrobbles:string[]=[],editionSources:PlaybackSource[]=[];
let restore:()=>void=()=>{};
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 config=await getConfig();credential=await encryptCredential(JSON.stringify({accessToken:'synthetic-generation-token'}));
 const db=getSql();
 await db`INSERT INTO system_settings(key,value) VALUES('coast',${{...config,experimentalMusic:true,experimentalParties:true}}::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
 await db`INSERT INTO users(id,username,role) VALUES(${user},${'generation-'+user},'admin')`;
 await db`INSERT INTO media(id,kind,title) VALUES(${movie},'movie','Generation fixture')`;
 await db`INSERT INTO works(id,category,kind) VALUES(${track},'music','track')`;
 await db`INSERT INTO music_works(id,kind,title,duration_seconds) VALUES(${track},'track','Generation audio',120)`;
 await db`INSERT INTO provider_instances(id,provider,name,base_url) VALUES(${instance},'jellyfin','Generation fixture','https://generation-fixture.invalid')`;
 await db`INSERT INTO provider_connections(id,user_id,instance_id,status,external_user_id,credentials) VALUES(${connection},${user},${instance},'connected','account-a',${credential})`;
 for(const [work,externalId,kind] of [[movie,'video-item','movie'],[track,'audio-item','track']]){
  const [item]=await db`INSERT INTO provider_items(instance_id,media_id,external_id,kind) VALUES(${instance},${work},${externalId},${kind}) RETURNING id`;
  await db`INSERT INTO availability(user_id,connection_id,media_id,provider_item_id,source_id,duration_seconds) VALUES(${user},${connection},${work},${item.id},'source',120)`;
 }
 const original=connections.getJellyfin,views=queries.mediaViews;
 const account=spyOn(connections,'getJellyfin').mockImplementation(async(uid,id)=>{
  const context=await original(uid,id);
  context.adapter.identity=async(_expected,signal)=>{await onIdentity(signal);return {id:'synthetic-server',name:'Fixture',version:'fixture'};};
  context.adapter.playbackInfo=async(itemId,_userId,_capabilities,_maxBitrate,options)=>{
   infos++;await onInfo(options?.signal);
   const audio=itemId==='audio-item';
   const source:PlaybackSource={id:'source',name:'Original',container:audio?'m4a':'mp4',bitrate:1_000_000,durationSeconds:120,directPlay:true,directStream:true,transcoding:true,transcodingUrl:`/${audio?'Audio':'Videos'}/${itemId}/master.m3u8`,raw:{},streams:audio?[{type:'Audio',codec:'aac',index:0}]:[{type:'Video',codec:'h264',index:0,width:1280,height:720},{type:'Audio',codec:'aac',index:1}]};
   return {sources:[source,...editionSources],playSessionId:crypto.randomUUID()};
  };
  context.adapter.scrobble=async()=>{scrobbles.push(context.connection.externalUserId!);};
  return context;
 });
 const presentation=spyOn(queries,'mediaViews').mockImplementation(async(...args)=>{await onPresentation();return views(...args);});
 const relay=spyOn(transport,'secureProviderFetch').mockImplementation(async()=>{relays++;return new Response('synthetic',{headers:{'content-type':'video/mp4'}});});
 restore=()=>{account.mockRestore();presentation.mockRestore();relay.mockRestore();};
});
beforeEach(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 onIdentity=async()=>{};onInfo=async()=>{};onPresentation=async()=>{};infos=0;relays=0;scrobbles=[];editionSources=[];
 const db=getSql();
 await db`DELETE FROM synced_rooms WHERE host_id=${user}`;
 await db`DELETE FROM playback_sessions WHERE user_id=${user}`;
 await db`DELETE FROM outbox_actions WHERE user_id=${user}`;
 await db`UPDATE provider_connections SET external_user_id='account-a',credentials=${credential},status='connected' WHERE id=${connection}`;
 await db`UPDATE availability SET state='available' WHERE connection_id=${connection}`;
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;restore();const db=getSql();
 await db`DELETE FROM users WHERE id=${user}`;await db`DELETE FROM works WHERE id IN (${movie},${track})`;await db`DELETE FROM provider_instances WHERE id=${instance}`;
 await db`UPDATE system_settings SET value=${config}::jsonb WHERE key='coast'`;
});
const sessionRows=()=>getSql()<{id:string;state:string;account_generation:string|null}[]>`SELECT id,state,account_generation FROM playback_sessions WHERE user_id=${user}`;
async function replaceAccount(){await getSql()`UPDATE provider_connections SET external_user_id='account-b',credentials=${credential} WHERE id=${connection}`;}

for(const operation of ['identity','playbackInfo'] as const) {
 run(`saturated ${operation} preserves retryable 503 for video, music and shared playback`,async()=>{
  const origin=crypto.randomUUID(),abort=new AbortController(),release=deferred();
  const active=queueProviderRequest(origin,0,()=>release.promise);
  const waiting=Array.from({length:providerRequestLimits.perOrigin},()=>
   requestPriority.run(0,()=>queueProviderRequest(origin,0,async()=>{},abort.signal)).catch(error=>error));
  const contact=async()=>{await queueProviderRequest(origin,0,async()=>{});};
  if(operation==='identity')onIdentity=contact;else onInfo=contact;
  try {
   for(const mediaId of [movie,track]) {
    const request=new Request('https://coast.invalid/api/v1/playback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mediaId,browser})});
    const response=await handler({request,url:new URL(request.url),params:{path:'playback'},locals:{user:{id:user,username:'fixture',email:null,role:'admin',settings:{}}}} as Parameters<typeof handler>[0]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({code:'provider_queue_busy'});
   }
   await expect(startPlayback(user,{mediaId:movie,browser},{id:crypto.randomUUID(),viewerId:user,connectionId:connection,expiresAt:new Date(Date.now()+60000),maxBitrate:2_000_000})).rejects.toBeInstanceOf(ProviderQueueBusyError);
   expect(await sessionRows()).toEqual([]);
  } finally {
   abort.abort();release.resolve();await Promise.all([active,...waiting]);
  }
 });
 for(const failingAttempt of [1,2]) run(`busy ${operation} on candidate ${failingAttempt} still permits another candidate to start`,async()=>{
  const db=getSql(),externalId='fallback-'+crypto.randomUUID();
  const [item]=await db`INSERT INTO provider_items(instance_id,media_id,external_id,kind) VALUES(${instance},${movie},${externalId},'movie') RETURNING id`;
  await db`INSERT INTO availability(user_id,connection_id,media_id,provider_item_id,source_id,duration_seconds) VALUES(${user},${connection},${movie},${item.id},'source',120)`;
  let attempts=0;
  const contact=async()=>{if(++attempts===failingAttempt)throw new ProviderQueueBusyError();};
  if(operation==='identity')onIdentity=contact;else onInfo=contact;
  try {
   const session=await startPlayback(user,{mediaId:movie,browser});
   expect(attempts).toBe(2);expect(session.kind).toBe('direct');
   expect((await sessionRows()).map(row=>row.id)).toEqual([session.id]);
  } finally {
   await db`DELETE FROM availability WHERE provider_item_id=${item.id}`;
   await db`DELETE FROM provider_items WHERE id=${item.id}`;
  }
 });
}
run('busy preparation preserves existing playback and cancellation takes precedence',async()=>{
 const active=await startPlayback(user,{mediaId:movie,browser});
 await progressPlayback(user,active.id,{event:'start',positionSeconds:0});
 const busy=new ProviderQueueBusyError();onInfo=async()=>{throw busy;};
 await expect(startPlayback(user,{mediaId:movie,browser})).rejects.toBe(busy);
 const abort=new AbortController(),reason=new DOMException('Closed','AbortError');
 onInfo=async()=>{abort.abort(reason);throw busy;};
 await expect(startPlayback(user,{mediaId:movie,browser},undefined,abort.signal)).rejects.toBe(reason);
 expect((await sessionRows()).map(({id,state})=>({id,state}))).toEqual([{id:active.id,state:'active'}]);
});
run('ordinary provider failure retains the existing no-playable-version result',async()=>{
 onInfo=async()=>{throw new Error('Synthetic provider failure');};
 await expect(startPlayback(user,{mediaId:movie,browser})).rejects.toThrow('No available version can play');
 expect(await sessionRows()).toEqual([]);
});

run('already-aborted preparation does no provider work or session publication',async()=>{
 const abort=new AbortController(),reason=new DOMException('Closed','AbortError');abort.abort(reason);
 await expect(startPlayback(user,{mediaId:movie,browser},undefined,abort.signal)).rejects.toBe(reason);
 expect(infos).toBe(0);expect(await sessionRows()).toEqual([]);
});
run('cancelling PlaybackInfo reaches the provider boundary and publishes no session',async()=>{
 const entered=deferred(),abort=new AbortController(),reason=new DOMException('Closed','AbortError');
 let received:AbortSignal|undefined;
 onInfo=signal=>{received=signal;entered.resolve();return new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 const pending=startPlayback(user,{mediaId:movie,browser},undefined,abort.signal);await entered.promise;
 expect(received).toBe(abort.signal);abort.abort(reason);
 await expect(pending).rejects.toBe(reason);expect(infos).toBe(1);expect(await sessionRows()).toEqual([]);
});
run('abort during final presentation leaves no new session and preserves existing active playback',async()=>{
 const active=await startPlayback(user,{mediaId:movie,browser});await progressPlayback(user,active.id,{event:'start',positionSeconds:0});
 const entered=deferred(),release=deferred(),abort=new AbortController(),reason=new DOMException('Closed','AbortError');
 onPresentation=async()=>{entered.resolve();await release.promise;};
 const pending=startPlayback(user,{mediaId:movie,browser},undefined,abort.signal);await entered.promise;
 expect(await sessionRows()).toHaveLength(1);abort.abort(reason);release.resolve();
 await expect(pending).rejects.toBe(reason);expect((await sessionRows()).map(({id,state})=>({id,state}))).toEqual([{id:active.id,state:'active'}]);
});
run('account replacement during PlaybackInfo cannot publish its old candidate',async()=>{
 const entered=deferred(),release=deferred();onInfo=async()=>{entered.resolve();await release.promise;};
 const pending=startPlayback(user,{mediaId:movie,browser});await entered.promise;await replaceAccount();release.resolve();
 await expect(pending).rejects.toThrow('account changed');expect(await sessionRows()).toEqual([]);
});
run('account replacement during final presentation cannot publish a stale prepared session',async()=>{
 const entered=deferred(),release=deferred();onPresentation=async()=>{entered.resolve();await release.promise;};
 const pending=startPlayback(user,{mediaId:movie,browser});await entered.promise;
 expect(await sessionRows()).toEqual([]);await replaceAccount();release.resolve();
 await expect(pending).rejects.toThrow('account changed');expect(await sessionRows()).toEqual([]);
});
run('a cancellation observed immediately after commit retires the prepared row',async()=>{
 const db=getDb(),transaction=db.transaction.bind(db),abort=new AbortController(),reason=new DOMException('Closed','AbortError');
 const boundary=spyOn(db,'transaction').mockImplementation((async(callback,options)=>{const result=await transaction(callback,options);abort.abort(reason);return result;}) as typeof db.transaction);
 try{await expect(startPlayback(user,{mediaId:movie,browser},undefined,abort.signal)).rejects.toBe(reason);}
 finally{boundary.mockRestore();}
 expect((await sessionRows()).map(row=>row.state)).toEqual(['stopped']);expect(relays).toBe(0);expect(scrobbles).toEqual([]);
});
run('replaced personal video and music sessions cannot progress, relay, join parties or scrobble as the new account',async()=>{
 for(const options of [{mediaId:movie,browser},{mediaId:movie,browser:{...browser,containers:[]}},{mediaId:track,browser}]){
  const session=await startPlayback(user,options);
  expect(session.kind).toBe(options.browser.containers.length?'direct':'hls');
  const [account]=await getSql()`SELECT account_generation FROM provider_connections WHERE id=${connection}`;
  expect((await sessionRows()).find(row=>row.id===session.id)?.account_generation).toBe(account.account_generation);
  await progressPlayback(user,session.id,{event:'start',positionSeconds:1});
  await executeJellyfinScrobble(user,connection,{sessionId:session.id,event:'start',positionSeconds:1});
  expect(scrobbles.at(-1)).toBe('account-a');
  const before=scrobbles.length;
  await replaceAccount();
  await expect(progressPlayback(user,session.id,{event:'progress',positionSeconds:100,playedSeconds:100})).rejects.toThrow(/expired|account changed/);
  const response=await streamPlayback(user,session.id,new Request('https://coast.invalid'+session.url));expect(response.status).toBe(410);expect(relays).toBe(0);
  await executeJellyfinScrobble(user,connection,{sessionId:session.id,event:'stop',positionSeconds:100});expect(scrobbles).toHaveLength(before);
  await expect(createRoom(user,{playbackId:session.id})).rejects.toMatchObject({status:409});
  const remaining=await getSql()<{id:string}[]>`SELECT id FROM outbox_actions WHERE user_id=${user} AND kind='jellyfin.scrobble' AND state<>'cancelled'`;expect(remaining).toHaveLength(0);
  await getSql()`UPDATE availability SET state='available' WHERE connection_id=${connection}`;
  const fresh=await startPlayback(user,options);await progressPlayback(user,fresh.id,{event:'start',positionSeconds:1});
  await executeJellyfinScrobble(user,connection,{sessionId:fresh.id,event:'start',positionSeconds:1});expect(scrobbles.at(-1)).toBe('account-b');
  // Return to A for the second medium without granting old sessions its new generation.
  await getSql()`UPDATE provider_connections SET external_user_id='account-a' WHERE id=${connection}`;
  await getSql()`UPDATE availability SET state='available' WHERE connection_id=${connection}`;
 }
});

run('named edition selection retains quality policy and stores the exact selected source for sync',async()=>{
 const db=getSql();const [original]=await db`SELECT provider_item_id FROM availability WHERE user_id=${user} AND media_id=${movie}`;
 const source=(id:string,width:number):PlaybackSource=>({id,name:`Director's Cut ${width===1920?'1080p':'720p'}`,container:'mp4',bitrate:width===1920?2_000_000:1_000_000,durationSeconds:120,directPlay:true,directStream:true,transcoding:true,raw:{},streams:[{type:'Video',codec:'h264',index:0,width,height:width===1920?1080:720},{type:'Audio',codec:'aac',index:1}]});
 editionSources=[source('cut-low',1280),source('cut-high',1920)];
 try{
  await db`UPDATE availability SET edition='1080p' WHERE provider_item_id=${original.provider_item_id}`;
  for(const source of editionSources)await db`INSERT INTO availability(user_id,connection_id,media_id,provider_item_id,source_id,edition,duration_seconds) VALUES(${user},${connection},${movie},${original.provider_item_id},${source.id},${source.name},120)`;
  const session=await startPlayback(user,{mediaId:movie,browser,editionName:'directors cut'});
  const [saved]=await db`SELECT source_id,edition FROM playback_sessions WHERE id=${session.id}`;
  expect(saved.source_id).toBe('cut-high');expect(saved.edition).toBe("Director's Cut 1080p");expect(infos).toBe(1);
  await expect(startPlayback(user,{mediaId:movie,browser,editionName:'extended edition'})).rejects.toThrow('no longer available');
 }finally{
  await db`DELETE FROM availability WHERE provider_item_id=${original.provider_item_id} AND source_id in ('cut-low','cut-high')`;
  await db`UPDATE availability SET edition=null WHERE provider_item_id=${original.provider_item_id}`;
 }
});

run('edition presentation uses only permitted Jellyfin items, source runtime and existing override precedence',async()=>{
 const db=getSql(),extended=crypto.randomUUID();
 const [original]=await db`SELECT id FROM provider_items WHERE instance_id=${instance} AND external_id='video-item'`;
 await db`UPDATE provider_items SET snapshot=${{title:'Theatrical title',overview:'Original synopsis',artwork:{primary:'/theatrical.jpg'},posterPath:'/theatrical.jpg'}}::jsonb WHERE id=${original.id}`;
 await db`INSERT INTO provider_items(id,instance_id,media_id,external_id,kind,snapshot) VALUES(${extended},${instance},${movie},${'extended-'+extended},'movie',${{title:'Extended title',overview:'Longer synopsis',backdropPath:'/extended.jpg',artwork:{backdrop:'/extended.jpg'},runtimeMinutes:120}}::jsonb)`;
 await db`INSERT INTO availability(user_id,connection_id,media_id,provider_item_id,source_id,edition,duration_seconds) VALUES(${user},${connection},${movie},${extended},'extended','Extended Edition',12540)`;
 try{
  const [theatrical]=await queries.mediaViews(user,{ids:[movie],editionName:'theatrical'});
  const [cut]=await queries.mediaViews(user,{ids:[movie],editionName:'extended edition'});
  expect(theatrical).toMatchObject({title:'Theatrical title',overview:'Original synopsis',poster:'/theatrical.jpg',runtimeMinutes:2});
  expect(cut).toMatchObject({title:'Extended title',overview:'Longer synopsis',backdrop:'/extended.jpg',runtimeMinutes:209});
  await db`INSERT INTO user_metadata_preferences(user_id,media_id,title,backdrop_path) VALUES(${user},${movie},'My title','/personal.jpg')`;
  await db`INSERT INTO metadata_overrides(media_id,overview) VALUES(${movie},'Curated synopsis')`;
  const [personal]=await queries.mediaViews(user,{ids:[movie],editionName:'extended edition'});
  expect(personal).toMatchObject({title:'My title',overview:'Curated synopsis',backdrop:'/personal.jpg',runtimeMinutes:209});
  await db`UPDATE availability SET state='unavailable' WHERE provider_item_id=${extended}`;
  await expect(queries.mediaViews(user,{ids:[movie],editionName:'extended edition'})).rejects.toThrow('This edition is no longer available.');
 }finally{
  await db`DELETE FROM user_metadata_preferences WHERE user_id=${user} AND media_id=${movie}`;
  await db`DELETE FROM metadata_overrides WHERE media_id=${movie}`;
  await db`DELETE FROM provider_items WHERE id=${extended}`;
  await db`UPDATE provider_items SET snapshot='{}'::jsonb WHERE id=${original.id}`;
 }
});
