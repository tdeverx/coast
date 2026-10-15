import {beforeAll,beforeEach,afterAll,test,expect,spyOn} from 'bun:test';
import {getDb,getSql} from '../src/lib/server/db';
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
let config:CoastConfig,credential:string,onInfo:()=>Promise<void>=async()=>{},onPresentation:()=>Promise<void>=async()=>{};
let infos=0,relays=0,scrobbles:string[]=[];
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
  context.adapter.identity=async()=>({id:'synthetic-server',name:'Fixture',version:'fixture'});
  context.adapter.playbackInfo=async(itemId)=>{
   infos++;await onInfo();
   const audio=itemId==='audio-item';
   const source:PlaybackSource={id:'source',name:'Original',container:audio?'m4a':'mp4',bitrate:1_000_000,durationSeconds:120,directPlay:true,directStream:true,transcoding:true,transcodingUrl:`/${audio?'Audio':'Videos'}/${itemId}/master.m3u8`,raw:{},streams:audio?[{type:'Audio',codec:'aac',index:0}]:[{type:'Video',codec:'h264',index:0,width:1280,height:720},{type:'Audio',codec:'aac',index:1}]};
   return {sources:[source],playSessionId:crypto.randomUUID()};
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
 onInfo=async()=>{};onPresentation=async()=>{};infos=0;relays=0;scrobbles=[];
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

run('already-aborted preparation does no provider work or session publication',async()=>{
 const abort=new AbortController(),reason=new DOMException('Closed','AbortError');abort.abort(reason);
 await expect(startPlayback(user,{mediaId:movie,browser},undefined,abort.signal)).rejects.toBe(reason);
 expect(infos).toBe(0);expect(await sessionRows()).toEqual([]);
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
