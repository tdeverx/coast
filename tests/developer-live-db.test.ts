import {beforeAll,afterAll,beforeEach,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {getConfig,type CoastConfig} from '../src/lib/server/config';
import {updateConfig} from '../src/lib/application/configuration.server';
import {scheduleProviderMaintenance,runProviderJob,updateProviderSchedule} from '../src/lib/providers/maintenance.server';
import {claimNextAction,enqueueAction,registerActionHandler,runQueueOnce,retryAction} from '../src/lib/server/queue';
import {presence} from '../src/lib/social/presence.server';
import {liveObservationExpiry} from '../src/lib/social/live-freshness.server';
import {activeStreams,refreshStreams,streamCards,streamCount} from '../src/lib/application/streams.server';
import {recordServerStreams} from '../src/lib/providers/jellyfin/stream-history.server';
import {streamPresentation} from '../src/lib/providers/jellyfin/streams';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID(),show=crypto.randomUUID(),episode=crypto.randomUUID();
const actor={id:user,username:'dev-fixture',role:'admin' as const,email:null,settings:{}};
let config:CoastConfig,generation:string;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();config=await getConfig();
 await db`insert into users(id,username,role) values(${user},${'developer-'+user},'admin')`;
 await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Fixture','https://fixture.invalid')`;
 await db`insert into provider_connections(id,user_id,instance_id,status,external_user_id,credentials) values(${connection},${user},${instance},'connected','fixture','fixture')`;
 generation=(await db`select account_generation from provider_connections where id=${connection}`)[0].account_generation;
 await db`insert into media(id,kind,title) values(${show},'show','Fixture Show'),(${episode},'episode','Episode name should not appear')`;
 await db`insert into shows(media_id) values(${show})`;
 await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${episode},${show},1,3)`;
});
beforeEach(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await getSql()`delete from outbox_actions where user_id=${user}`;await getSql()`delete from social_live_state where connection_id=${connection}`;await getSql()`delete from server_stream_sessions where instance_id=${instance}`;await getSql()`delete from server_stream_scans where instance_id=${instance}`;await getSql()`update provider_instances set settings='{}'::jsonb where id=${instance}`;await updateConfig(actor,{developerMode:true});});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await updateConfig(actor,config);const db=getSql();await db`delete from users where id=${user}`;await db`delete from provider_instances where id=${instance}`;await db`delete from media where id in (${episode},${show})`;});
async function automatic(){const [row]=await getSql()`insert into outbox_actions(user_id,connection_id,account_generation,kind,payload) values(${user},${connection},${generation},'jellyfin.live','{}'::jsonb) returning id`;return row.id;}
async function observation(age=0,expired=false){await getSql()`insert into social_live_state(connection_id,account_generation,work_id,checked_at,expires_at) values(${connection},${generation},${episode},now()-make_interval(mins=>${age}),now()+make_interval(mins=>${expired?-1:5}))` ;}
run('developer mode stops timers and existing automatic work; Run promotes one existing job',async()=>{
 const job=await automatic();expect((await scheduleProviderMaintenance()).queued).toBe(0);expect(await claimNextAction()).toBeNull();
 await runProviderJob(user,instance,'live','jellyfin.live');expect((await claimNextAction())?.id).toBe(job);
 expect((await getSql()`select count(*)::int as n from outbox_actions where user_id=${user}`)[0].n).toBe(1);
});
run('paused background work cannot block intentional changes; disabling dev mode resumes it',async()=>{
 const job=await automatic();const edit=await enqueueAction({userId:user,connectionId:connection,kind:'jellyfin.user-state',payload:{}});
 expect((await claimNextAction())?.id).toBe(edit);await getSql()`update outbox_actions set state='succeeded' where id=${edit}`;
 expect(await claimNextAction()).toBeNull();await updateConfig(actor,{developerMode:false});expect((await claimNextAction())?.id).toBe(job);
});
run('a manual job failure waits for Retry in developer mode and clears failed live observations',async()=>{
 await observation();await enqueueAction({userId:user,connectionId:connection,kind:'jellyfin.live',payload:{}});
 registerActionHandler('jellyfin.live',async()=>{throw Error('Fixture connection failure');});expect(await runQueueOnce()).toBe(true);
 const [job]=await getSql()`select id,state from outbox_actions where user_id=${user}`;expect(job.state).toBe('failed');expect(await claimNextAction()).toBeNull();
 expect((await getSql()`select work_id from social_live_state where connection_id=${connection}`)[0].work_id).toBeNull();
 await retryAction(actor,job.id);expect((await claimNextAction())?.id).toBe(job.id);
});
run('friends live activity survives a queued scan, expires if abandoned, and uses show/episode context',async()=>{
 await observation(3,true);const job=await automatic();
 const live=await presence(user);expect(live).toHaveLength(1);expect(live[0].title).toBe('Fixture Show — S01E03');expect(live[0].href).toBe('/media/'+episode);
 await getSql()`update social_live_state set checked_at=now()-interval '31 minutes' where connection_id=${connection}`;expect(await presence(user)).toHaveLength(0);
 await getSql()`update social_live_state set checked_at=now()-interval '3 minutes' where connection_id=${connection}`;
 await getSql()`update outbox_actions set state='failed' where id=${job}`;expect(await presence(user)).toHaveLength(0);
});
run('live expiry accommodates a service scan cycle without exceeding provider expiry',async()=>{
 const now=new Date(),context={id:instance,provider:'jellyfin',settings:{}};
 const expiry=await liveObservationExpiry(context,now);expect(expiry.getTime()-now.getTime()).toBe(3*60000);
 const remote=new Date(now.getTime()+60000).toISOString();expect((await liveObservationExpiry(context,now,remote)).toISOString()).toBe(remote);
});
run('server-wide streams cannot be read by a non-administrator',async()=>{await expect(activeStreams({...actor,role:'user'})).rejects.toThrow('Administrator');});
run('an unscanned server and a failed scan do not imply missing administrator permissions',async()=>{
 expect((await activeStreams(actor)).issues[0].message).toContain('No server scan has completed');
 const id=await enqueueAction({userId:user,connectionId:connection,kind:'jellyfin.streams',payload:{}});
 await getSql()`update outbox_actions set state='failed' where id=${id}`;
 expect((await activeStreams(actor)).issues[0].message).toContain('scan failed');
 expect(await refreshStreams(actor)).toEqual({queued:0,needsAttention:1,unavailable:0});
 expect((await getSql()`select count(*)::int as count from outbox_actions where user_id=${user}`)[0].count).toBe(1);
});
run('stream cards resolve existing media and accounts; unimported streams have no invented destinations',async()=>{
 const db=getSql();await db`insert into provider_items(instance_id,media_id,external_id,kind) values(${instance},${episode},'stream-episode','episode')`;
 await db`insert into user_identities(instance_id,external_user_id,user_id) values(${instance},'jellyfin-user',${user})`;
 try{
  const mapped=streamPresentation({Id:'mapped',UserId:'jellyfin-user',UserName:'Remote name',NowPlayingItem:{Id:'stream-episode',Name:'Episode',Type:'Episode',SeriesName:'Fixture Show',ParentIndexNumber:1,IndexNumber:3}})!;
  const unknown=streamPresentation({Id:'unmapped',UserId:'unknown',UserName:'Jellyfin only',NowPlayingItem:{Id:'unknown-movie',Name:'Unknown movie',Type:'Movie'}})!;
  const cards=await streamCards(user,instance,[mapped,unknown]);
  expect(cards[0].card.id).toBe(episode);expect(cards[0].actor.profileHref).toBe('/profile/developer-'+user);
  expect(cards[1].card.title).toBe('Unknown movie');expect(cards[1].card.kind).toBe('movie');expect('href' in cards[1].card&&cards[1].card.href).toBeNull();expect(cards[1].actor.profileHref).toBeNull();
 }finally{await db`delete from user_identities where instance_id=${instance}`;await db`delete from provider_items where instance_id=${instance}`;}
});
function sample(id='session',item='title',paused=false){return streamPresentation({Id:id,UserName:'Player',NowPlayingItem:{Id:item,Name:item,Type:'Movie',RunTimeTicks:100_000_000},PlayState:{IsPaused:paused,PositionTicks:20_000_000}})!;}
const capture=(offset=0)=>({connectionId:connection,generation,checkedAt:new Date(Date.now()+offset)});
run('server observations update once, include paused sessions, and failures do not create history',async()=>{
 expect(await recordServerStreams(capture(),[sample(),sample('paused','other',true)])).toBe(true);
 expect((await streamCount(actor)).active).toBe(2);
 await recordServerStreams(capture(1000),[sample(),sample('paused','other',true)]);
 expect((await activeStreams(actor)).streams).toHaveLength(2);
 await recordServerStreams(capture(2000),null,'Scan unavailable');
 expect((await streamCount(actor)).active).toBeNull();
 expect((await activeStreams(actor)).streams).toHaveLength(2);
 expect((await activeStreams(actor,{view:'history'})).streams).toHaveLength(0);
 await recordServerStreams(capture(3000),[]);
 expect((await streamCount(actor)).active).toBe(0);
 expect((await activeStreams(actor,{view:'history'})).streams).toHaveLength(2);
});
run('media changes create separate sessions while preserving the previous observed position',async()=>{
 await recordServerStreams(capture(),[sample()]);await recordServerStreams(capture(1000),[sample('session','new title')]);
 const history=await activeStreams(actor,{view:'history'}),now=await activeStreams(actor);
 expect(history.streams[0].title).toBe('title');expect(history.streams[0].position).toBe(2);
 expect(now.streams[0].title).toBe('new title');expect(history.streams[0].id).not.toBe(now.streams[0].id);
});
run('old account generations, superseded scans and recovered worker leases cannot publish',async()=>{
 const source=capture();await recordServerStreams(source,[sample()]);
 expect(await recordServerStreams({...source,checkedAt:new Date(source.checkedAt.getTime()-1)},[])).toBe(false);
 expect(await recordServerStreams({...capture(1000),generation:crypto.randomUUID()},[])).toBe(false);
 const id=await automatic();await getSql()`update outbox_actions set state='running',attempts=2 where id=${id}`;
 expect(await recordServerStreams({...capture(1000),action:{id,attempts:1}},[])).toBe(false);
 expect((await streamCount(actor)).active).toBe(1);
 expect(await recordServerStreams({...capture(2000),action:{id,attempts:2}},[sample('current')])).toBe(true);
 expect((await activeStreams(actor)).streams[0].title).toBe('title');
});
run('history keyset pagination retains equal-time observations and count is independent of page size',async()=>{
 await recordServerStreams(capture(),Array.from({length:22},(_,i)=>sample('session-'+i,'item-'+i)));
 expect((await streamCount(actor)).active).toBe(22);const now=await activeStreams(actor);expect(now.streams).toHaveLength(20);
 await recordServerStreams(capture(500),Array.from({length:22},(_,i)=>sample('session-'+i,'item-'+i)));
 expect((await activeStreams(actor,{before:now.nextCursor})).streams).toHaveLength(2);
 await recordServerStreams(capture(1000),[]);
 const first=await activeStreams(actor,{view:'history'});expect(first.streams).toHaveLength(20);expect(first.nextCursor).toBeTruthy();
 const second=await activeStreams(actor,{view:'history',before:first.nextCursor});expect(second.streams).toHaveLength(2);
 expect(new Set([...first.streams,...second.streams].map(s=>s.id)).size).toBe(22);
 await expect(activeStreams(actor,{before:'invalid'})).rejects.toThrow();
});
run('server-stream task is manual in developer mode, deduplicated per service, and configurable',async()=>{
 expect((await scheduleProviderMaintenance({instanceId:instance,task:'streams'})).queued).toBe(0);
 await updateProviderSchedule(user,instance,{streamsIntervalMinutes:2,streamsConnectionId:connection});
 expect((await runProviderJob(user,instance,'streams','jellyfin.streams')).queued).toBe(1);
 expect((await runProviderJob(user,instance,'streams','jellyfin.streams')).queued).toBe(0);
 expect((await getSql()`select kind from outbox_actions where user_id=${user}`)).toHaveLength(1);
 expect((await claimNextAction())?.kind).toBe('jellyfin.streams');
 await expect(updateProviderSchedule(user,instance,{streamsConnectionId:crypto.randomUUID()})).rejects.toThrow('administrator');
});
run('server-stream count and history are admin only; disconnected sources hide current observations',async()=>{
 await expect(streamCount({...actor,role:'user'})).rejects.toThrow('Administrator');
 await expect(activeStreams({...actor,role:'user'},{view:'history'})).rejects.toThrow('Administrator');
 await recordServerStreams(capture(),[sample()]);
 await getSql()`update provider_connections set status='disconnected' where id=${connection}`;
 try{expect((await streamCount(actor)).active).toBeNull();expect((await activeStreams(actor)).streams).toHaveLength(0);}
 finally{await getSql()`update provider_connections set status='connected' where id=${connection}`;}
});
