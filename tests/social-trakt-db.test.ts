import { initialTraktSync } from '../src/lib/providers/trakt/access';
import {beforeAll,afterAll,test,expect} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import {users,providerInstances,providerConnections,media} from '../src/lib/server/db/schema';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import {defaultSyncPreferences} from '../src/lib/providers/contracts';
import {ingestMetadata} from '../src/lib/catalogue/service.server';
import {pollLiveFromAdapter,deliverCheckinToAdapter} from '../src/lib/social/trakt.server';
import {executeLiveScrobbleToAdapter} from '../src/lib/sync/trakt-export.server';
import {track} from '../src/lib/core/tracking/service.server';
import {startCheckin,cancelCheckin,completeCheckin} from '../src/lib/social/presence.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let userId:string,workId:string,context:Awaited<ReturnType<typeof import('../src/lib/providers/trakt/connection.server').getTrakt>>;
const numeric=1_500_000_000+Math.floor(Math.random()*300_000_000);
const movie={title:'Social live fixture',runtime:1,ids:{trakt:numeric}};
let remote:unknown=null,history:unknown[]=[],calls:string[]=[],loseScrobble=false;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const [user]=await getDb().insert(users).values({username:'live-social-'+crypto.randomUUID()}).returning();userId=user.id;
 const [instance]=await getDb().insert(providerInstances).values({provider:'trakt',name:'Social live fixture',baseUrl:'https://fixture.invalid',enabled:false}).returning();
 const sync={...defaultSyncPreferences,history:true,scrobble:true};
 const [connection]=await getDb().insert(providerConnections).values({userId,instanceId:instance.id,status:'connected',externalUserId:'fixture',settings:{sync,traktAccess:{import:true,export:true}}}).returning();
 workId=(await ingestMetadata({provider:'trakt',externalId:String(numeric),kind:'movie',title:movie.title,runtimeMinutes:1})).id;
 const adapter=new TraktAdapter(async(path,init)=>{
  const route=path.split('?')[0];calls.push(`${init?.method??'GET'} ${route}`);
  if(route==='/users/me/watching')return remote;
  if(route==='/sync/history')return history;
  if(route==='/scrobble/stop'){if(loseScrobble)throw Error('Lost delivery response');return {id:800,progress:JSON.parse(String(init?.body)).progress,action:'scrobble'};}
  if(route==='/checkin'&&init?.method==='POST'){remote={id:700,started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),action:'checkin',type:'movie',movie};return {id:700,watched_at:(remote as {started_at:string}).started_at,movie};}
  if(route==='/checkin'&&init?.method==='DELETE'){remote=null;return null;}
  throw Error('Unexpected fixture request: '+path);
 },'fixture','fixture');
 context={instance,connection,adapter,sync};
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 await getDb().delete(users).where(eq(users.id,userId));
 await getDb().delete(providerInstances).where(eq(providerInstances.id,context.instance.id));
 await getDb().delete(media).where(eq(media.id,workId));
 await getSql()`delete from works where id=${workId}`;
});
run('live polling works independently of history imports and honors its own opt-out',async()=>{
 remote={id:1,started_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),action:'checkin',type:'movie',movie};calls=[];
 await pollLiveFromAdapter(userId,context.connection.id,{...context,sync:{...context.sync,history:false}});
 expect(calls).toEqual(['GET /users/me/watching']);
 const [state]=await getSql()`select work_id,expires_at from social_live_state where connection_id=${context.connection.id}`;
 expect(state.work_id).toBe(workId);expect(new Date(state.expires_at).getTime()-Date.now()).toBeLessThan(181000);
 calls=[];await pollLiveFromAdapter(userId,context.connection.id,{...context,connection:{...context.connection,settings:{...context.connection.settings,liveRead:false}}});expect(calls).toHaveLength(0);
 remote=null;
});
run('confirmed check-in completion is neither exported nor imported as a second play',async()=>{
 const checkin=await startCheckin(userId,{workId});
 await deliverCheckinToAdapter(userId,context.connection.id,checkin.id,context);
 await deliverCheckinToAdapter(userId,context.connection.id,checkin.id,context);
 expect(calls.filter(c=>c==='POST /checkin')).toHaveLength(1);
 await getSql()`update social_checkins set expires_at=now()-interval '1 second' where id=${checkin.id}`;
 await completeCheckin(userId,checkin.id);remote=null;
 history=[{id:700,action:'checkin',type:'movie',movie,watched_at:new Date().toISOString()}];
 await pollLiveFromAdapter(userId,context.connection.id,context);
 expect(await getSql()`select id from tracking_events where user_id=${userId} and action='watch'`).toHaveLength(1);
 expect(await getSql()`select id from outbox_actions where connection_id=${context.connection.id} and kind='trakt.export' and payload->>'category'='history'`).toHaveLength(0);
});
run('confirmed owned cancellation matches exact start and work without relying on a watching ID',async()=>{
 const checkin=await startCheckin(userId,{workId});remote=null;calls=[];
 await deliverCheckinToAdapter(userId,context.connection.id,checkin.id,context);
 await cancelCheckin(userId,checkin.id);calls=[];
 await deliverCheckinToAdapter(userId,context.connection.id,checkin.id,context);
 expect(calls).toContain('DELETE /checkin');
});
run('uncertain delivery never retries a create and cancellation never touches unrelated remote watching',async()=>{
 const checkin=await startCheckin(userId,{workId});
 await getSql()`insert into social_live_deliveries(connection_id,checkin_id,account_generation,state) values(${context.connection.id},${checkin.id},${context.connection.accountGeneration},'uncertain')`;
 remote=null;calls=[];
 await expect(deliverCheckinToAdapter(userId,context.connection.id,checkin.id,context)).rejects.toThrow('uncertain');
 expect(calls).not.toContain('POST /checkin');
 await getSql()`update social_live_deliveries set state='started',remote_id='900' where checkin_id=${checkin.id}`;
 remote={id:901,started_at:new Date(Date.now()+5000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),action:'checkin',type:'movie',movie};
 await cancelCheckin(userId,checkin.id);calls=[];
 await deliverCheckinToAdapter(userId,context.connection.id,checkin.id,context);
 expect(calls).not.toContain('DELETE /checkin');
});

run('playback scrobble evidence prevents feedback and unknown delivery cannot create another remote play',async()=>{
 const sessionId=crypto.randomUUID();
 await track(userId,{mediaId:workId,action:'watch',source:'coast',sourceEventId:'playback:'+sessionId,rewatch:true});
 const before=await getSql()`select id from tracking_events where user_id=${userId} and action='watch'`;
 calls=[];const input={mediaId:workId,sessionId,event:'stop',progress:100};
 await executeLiveScrobbleToAdapter(userId,context.connection.id,input,context);
 await executeLiveScrobbleToAdapter(userId,context.connection.id,input,context);
 expect(calls.filter(c=>c==='POST /scrobble/stop')).toHaveLength(1);
 remote=null;history=[{id:800,type:'movie',movie,watched_at:new Date().toISOString()}];
 await pollLiveFromAdapter(userId,context.connection.id,context);
 expect(await getSql()`select id from tracking_events where user_id=${userId} and action='watch'`).toHaveLength(before.length);
 const lost={...input,sessionId:crypto.randomUUID()};loseScrobble=true;calls=[];
 await expect(executeLiveScrobbleToAdapter(userId,context.connection.id,lost,context)).rejects.toThrow('Lost delivery response');
 loseScrobble=false;
 await expect(executeLiveScrobbleToAdapter(userId,context.connection.id,lost,context)).rejects.toThrow('uncertain');
 expect(calls.filter(c=>c==='POST /scrobble/stop')).toHaveLength(1);
});

run('a pause receipt cannot mark a completed play as confirmed or trigger a second scrobble',async()=>{
 const input={mediaId:workId,sessionId:crypto.randomUUID(),event:'stop',progress:100};
 let attempts=0;
 const adapter=new TraktAdapter(async()=>{attempts++;return {id:801,action:'pause',progress:99};},'fixture','fixture');
 const deliver=()=>executeLiveScrobbleToAdapter(userId,context.connection.id,input,{...context,adapter});
 await expect(deliver()).rejects.toThrow('did not confirm a completed play');
 expect(await getSql()`select state,remote_id from social_scrobble_deliveries where session_id=${input.sessionId}`).toEqual([{state:'uncertain',remote_id:null}]);
 await expect(deliver()).rejects.toThrow('uncertain');
 expect(attempts).toBe(1);
});

run('disabling Trakt import or live activity clears just the current observation and excludes an in-flight response', async () => {
 const db=getSql(),{updateSyncPreferences}=await import('../src/lib/providers/trakt/connection.server');
 const connection=context.connection, accountGeneration=connection.accountGeneration;
 const preferences = initialTraktSync();
 preferences.import.live = true;
 preferences.export.scrobble = true;
 const observation={started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),action:'checkin',type:'movie',movie};
 await db`update provider_instances set enabled=true where id=${context.instance.id}`;
 try {
  for (const importHistory of [true,false]) {
   await updateSyncPreferences(userId,connection.id,{accountGeneration,traktSync:preferences});
   remote=observation;
   const scoped={...context,sync:{...context.sync,history:false}};
   await pollLiveFromAdapter(userId,connection.id,scoped);
   const [before]=await db`select work_id,history_cursor from social_live_state where connection_id=${connection.id}`;
   expect(before.work_id).toBe(workId);
   let release!:()=>void,entered!:()=>void;
   const started=new Promise<void>(done=>{entered=done;}),held=new Promise<void>(done=>{release=done;});
   const delayed=new TraktAdapter(async()=>{entered();await held;return observation;},'fixture','fixture');
   const poll=pollLiveFromAdapter(userId,connection.id,{...scoped,adapter:delayed}).catch((error:unknown)=>error);
   try {
    await started;
    await updateSyncPreferences(userId,connection.id,{accountGeneration,traktSync:{...preferences, import:{...preferences.import,live:false,history:importHistory}}});
    release();
    const result=await poll;
    expect(result).toBeInstanceOf(Error);
    expect(await db`select work_id,expires_at,history_cursor from social_live_state where connection_id=${connection.id}`)
     .toEqual([{work_id:null,expires_at:null,history_cursor:before.history_cursor}]);
   } finally {release();await poll;}
  }
 } finally {
  await db`update provider_connections set settings=${connection.settings}::jsonb where id=${connection.id}`;
  await db`update provider_instances set enabled=false where id=${context.instance.id}`;
  remote=null;
 }
});

run('disabling presence queues cleanup only for a Trakt account still allowed to export',async()=>{
 const db=getSql(),connection=context.connection;
 const {reconcileFeatures}=await import('../src/lib/application/feature-transition.server');
 const {defaultConfig}=await import('../src/lib/server/config');
 await db`update provider_instances set enabled=true where id=${context.instance.id}`;
 try {
  for(const writable of [false,true]){
   await db`update provider_connections set settings=${{...connection.settings,traktAccess:{import:true,export:writable}}}::jsonb where id=${connection.id}`;
   const [checkin]=await db`insert into social_checkins(user_id,work_id,expires_at) values(${userId},${workId},now()+interval '1 hour') returning id`;
   await db`insert into social_live_deliveries(connection_id,checkin_id,account_generation,state) values(${connection.id},${checkin.id},${connection.accountGeneration},'started')`;
   const [{at}]=await db`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`;
   await reconcileFeatures({id:crypto.randomUUID(),userId,connectionId:null,kind:'feature.reconcile',attempts:1,correlationId:'fixture',payload:{config:defaultConfig,subjectId:userId,choices:{presence:false},cutoff:at}});
   expect(await db`select state from social_checkins where id=${checkin.id}`).toEqual([{state:'cancelled'}]);
   expect(await db`select state from outbox_actions where connection_id=${connection.id} and kind='trakt.checkin' and payload->>'checkinId'=${checkin.id}`)
    .toEqual(writable?[{state:'pending'}]:[]);
  }
 } finally {
  await db`update provider_connections set settings=${connection.settings}::jsonb where id=${connection.id}`;
  await db`update provider_instances set enabled=false where id=${context.instance.id}`;
 }
});
