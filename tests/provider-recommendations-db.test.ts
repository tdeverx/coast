import {afterAll,beforeAll,expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {TmdbAdapter} from '../src/lib/providers/tmdb/adapter.server';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import {refreshProviderRecommendations} from '../src/lib/experiments/provider-recommendations.server';
import {enqueueAction,registerActionHandler,runQueueOnce,type OutboxAction} from '../src/lib/server/queue';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import {getConfig} from '../src/lib/server/config';
import {updateConfig} from '../src/lib/application/configuration.server';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const user=crypto.randomUUID(),instance=crypto.randomUUID(),traktInstance=crypto.randomUUID(),connection=crypto.randomUUID();
const works=Array.from({length:7},()=>crypto.randomUUID()),base=1750000000+Math.floor(Math.random()*100000);
const original=TmdbAdapter.prototype.recommendations,originalTrakt=TraktAdapter.prototype.recommendations;
let generation:string;
beforeAll(async()=>{
 if(!enabled)return;
 const db=getSql();
 await db`insert into users(id,username,role) values(${user},${`recommendations-${user}`},'admin')`;
 await db`insert into provider_instances(id,provider,name,base_url,credentials) values(${instance},'tmdb','Recommendation fixture','https://fixture.invalid',${await encryptCredential(JSON.stringify({apiKey:'fixture'}))}),(${traktInstance},'trakt','Personal fixture','https://fixture.invalid',${await encryptCredential(JSON.stringify({clientId:'fixture',clientSecret:'fixture'}))})`;
 const token=await encryptCredential(JSON.stringify({access_token:'fixture',refresh_token:'fixture',created_at:Math.floor(Date.now()/1000),expires_in:3600}));
 const [account]=await db`insert into provider_connections(id,user_id,instance_id,external_user_id,credentials) values(${connection},${user},${traktInstance},'fixture',${token}) returning account_generation`;generation=account.account_generation;
 for(const [index,id] of works.entries()){
  await db`insert into media(id,kind,title) values(${id},'movie','Seed fixture')`;
  await db`insert into external_ids(media_id,provider,external_id,media_kind) values(${id},'tmdb',${String(base+index)},'movie')`;
  await db`insert into tracking_state(user_id,media_id,favourite) values(${user},${id},true)`;
 }
});
afterAll(async()=>{
 TmdbAdapter.prototype.recommendations=original;TraktAdapter.prototype.recommendations=originalTrakt;
 if(!enabled)return;const db=getSql();
 await db`delete from provider_instances where id in (${instance},${traktInstance})`;
 await db`delete from users where id=${user}`;
 await db`delete from works where id=any(${db.array(works,'UUID')}::uuid[])`;
});
run('a forced recommendation refresh freezes six seeds and resumes without repeating completed sets',async()=>{
 const paths:string[]=[];
 TmdbAdapter.prototype.recommendations=async(_kind,id)=>{paths.push(id);return [];};
 registerActionHandler('tmdb.recommendations',refreshProviderRecommendations);
 const id=await enqueueAction({userId:user,connectionId:null,kind:'tmdb.recommendations',purpose:'manual',payload:{instanceId:instance,force:true}});
 try{
  expect(await runQueueOnce()).toBe(true);
  const [paused]=await getSql()`select state,attempts,payload from outbox_actions where id=${id}`;
  expect(paused.state).toBe('pending');expect(paused.attempts).toBe(0);
  expect(paused.payload._checkpoint.next).toBe(5);expect(paused.payload._checkpoint.seeds).toHaveLength(6);
  expect(paths).toHaveLength(5);
  // Changing taste/freshness while paused must not replace the retained batch.
  await getSql()`update tracking_state set favourite=false,watchlist=false where user_id=${user}`;
  expect(await runQueueOnce()).toBe(true);
  const [finished]=await getSql()`select state,payload from outbox_actions where id=${id}`;
  expect(finished.state).toBe('succeeded');expect(finished.payload._jobOutcome).toEqual({checked:6,added:0});
  expect(paths).toHaveLength(6);expect(new Set(paths).size).toBe(6);
  const [sets]=await getSql()`select count(*)::int as count from recommendation_sets where instance_id=${instance}`;
  expect(sets.count).toBe(6);
 }finally{TmdbAdapter.prototype.recommendations=original;}
});
run('a cancelled recommendation worker cannot publish a set after an upstream wait',async()=>{
 const id=crypto.randomUUID(),seed=works[6];
 const checkpoint={task:'provider-recommendations',instanceId:instance,seeds:[{id:seed,external_id:String(base+6),kind:'movie'}],next:0,added:0};
 await getSql()`insert into outbox_actions(id,user_id,kind,state,attempts,payload) values(${id},${user},'tmdb.recommendations','running',1,${{instanceId:instance,_checkpoint:checkpoint}}::jsonb)`;
 TmdbAdapter.prototype.recommendations=async()=>{await getSql()`update outbox_actions set state='cancelled' where id=${id}`;return [];};
 const action:OutboxAction={id,userId:user,connectionId:null,kind:'tmdb.recommendations',payload:{instanceId:instance},attempts:1,correlationId:crypto.randomUUID()};
 const [before]=await getSql()`select count(*)::int as count from recommendation_sets where instance_id=${instance}`;
 try{
  await expect(jobExecution.run({id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>refreshProviderRecommendations(action))).rejects.toBeInstanceOf(JobYield);
  const [after]=await getSql()`select count(*)::int as count from recommendation_sets where instance_id=${instance}`;
  expect(after.count).toBe(before.count);
 }finally{TmdbAdapter.prototype.recommendations=original;}
});
run('a replaced personal account cannot publish Trakt recommendations',async()=>{
 const config=await getConfig(),actor={id:user,username:'fixture',role:'admin' as const,email:null,settings:{}};
 await updateConfig(actor,{...config,enableTrakt:true});
 TraktAdapter.prototype.recommendations=async()=>{await getSql()`update provider_connections set external_user_id='replacement' where id=${connection}`;return [];};
 const action:OutboxAction={id:crypto.randomUUID(),userId:user,connectionId:connection,accountGeneration:generation,kind:'trakt.recommendations',payload:{instanceId:traktInstance},attempts:1,correlationId:crypto.randomUUID()};
 try{
  await expect(refreshProviderRecommendations(action)).rejects.toThrow('account changed');
  const [sets]=await getSql()`select count(*)::int as count from recommendation_sets where instance_id=${traktInstance}`;
  expect(sets.count).toBe(0);
 }finally{TraktAdapter.prototype.recommendations=originalTrakt;await updateConfig(actor,config);}
});
