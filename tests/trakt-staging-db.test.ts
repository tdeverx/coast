import { afterAll, beforeAll, expect, test } from 'bun:test';
import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { ingestMetadata } from '../src/lib/catalogue/service.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { importTraktFromAdapter } from '../src/lib/sync/trakt-import.server';
import { reconcileProviderValue } from '../src/lib/sync/values.server';
import { jobExecution, JobYield } from '../src/lib/server/queue/execution';
import { pruneTransientRecords } from '../src/lib/server/storage/retention.server';
import type { SyncPreferences } from '../src/lib/providers/contracts';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const sync:SyncPreferences={history:true,progress:false,ratings:false,watchlist:false,collection:false,lists:false,scrobble:false};
const tag=crypto.randomUUID(),numericId=1880000002;
let userId:string,connectionId:string,instanceId:string,mediaId:string,absentId:string,generation:string;
const date=(id:number)=>new Date(Date.UTC(2025,0,1)+Math.floor((id-1)/2)*60000).toISOString();
const movie={title:'Durable Trakt history fixture',runtime:90,ids:{trakt:numericId}};
const execute=(id:string,adapter:TraktAdapter,checkpoints=0,attempts=1)=>jobExecution.run({id,attempts,purpose:'scheduled',started:performance.now(),checkpoints},()=>importTraktFromAdapter(userId,connectionId,{adapter,sync}));
async function action(){
  const [row]=await getDb().insert(s.outboxActions).values({userId,connectionId,accountGeneration:generation,kind:'trakt.import',payload:{},state:'running',attempts:1}).returning();
  return row.id;
}
beforeAll(async()=>{
  if(!enabled)return;
  const db=getDb();
  [userId]=(await db.insert(s.users).values({username:`trakt-stage-${tag}`}).returning()).map(row=>row.id);
  [instanceId]=(await db.insert(s.providerInstances).values({provider:'trakt',name:tag,baseUrl:'https://fixture.invalid'}).returning()).map(row=>row.id);
  const [connection]=await db.insert(s.providerConnections).values({userId,instanceId,settings:{sync}}).returning();connectionId=connection.id;generation=connection.accountGeneration;
  mediaId=(await ingestMetadata({provider:'trakt',externalId:String(numericId),kind:'movie',title:movie.title,runtimeMinutes:90})).id;
  absentId=(await ingestMetadata({provider:'trakt',externalId:String(numericId+1),kind:'movie',title:'Absent Trakt history fixture'})).id;
});
afterAll(async()=>{
  if(!enabled)return;
  await getDb().delete(s.users).where(eq(s.users.id,userId));
  await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id,instanceId));
  for(const id of [mediaId,absentId]){await getDb().delete(s.media).where(eq(s.media.id,id));await getDb().delete(s.works).where(eq(s.works.id,id));}
});

run('history pages survive interruption; stale leases roll back effects; apply resumes oldest-first without duplication',async()=>{
  const db=getDb(),id=await action(),all=Array.from({length:205},(_,index)=>({id:205-index,watched_at:date(205-index),movie}));
  const reads:number[]=[];let fail=false;
  const adapter=new TraktAdapter(async(path)=>{
    if(path==='/sync/last_activities')return{all:'stable'};
    const page=Number(new URL(path,'https://fixture.invalid').searchParams.get('page'));reads.push(page);
    if(page===2&&fail)throw new Error('Interrupted staged page');
    return all.slice((page-1)*100,page*100);
  },'client','secret');
  await reconcileProviderValue(userId,connectionId,absentId,'history',{value:true},{source:'trakt'});
  await expect(execute(id,adapter,4)).rejects.toBeInstanceOf(JobYield);
  let [stage]=await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id));
  expect(stage).toMatchObject({nextPage:2,phase:'fetching'});
  expect(await db.select().from(s.traktImportRecords).where(eq(s.traktImportRecords.stageId,stage.id))).toHaveLength(100);
  fail=true;await expect(execute(id,adapter)).rejects.toThrow('Interrupted staged page');fail=false;
  expect((await db.select().from(s.trackingState).where(eq(s.trackingState.mediaId,absentId)))[0].watched).toBe(true);
  await expect(execute(id,adapter,4)).rejects.toBeInstanceOf(JobYield);
  await expect(execute(id,adapter,4)).rejects.toBeInstanceOf(JobYield);
  expect((await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id)))[0].phase).toBe('applying');
  await expect(execute(id,adapter,0,2)).rejects.toBeInstanceOf(JobYield);
  expect(await db.select().from(s.trackingEvents).where(eq(s.trackingEvents.mediaId,mediaId))).toHaveLength(0);
  for(let chunks=0;chunks<20;chunks++){
    try{await execute(id,adapter);break;}catch(error){if(!(error instanceof JobYield))throw error;}
  }
  const events=await db.select().from(s.trackingEvents).where(eq(s.trackingEvents.mediaId,mediaId)).orderBy(asc(s.trackingEvents.createdAt));
  const sorted=[...all].sort((a,b)=>a.watched_at.localeCompare(b.watched_at));
  expect(events.map(event=>event.sourceEventId)).toEqual(sorted.map(record=>`${connectionId}:history:${record.id}:${record.watched_at}`));
  expect((await db.select().from(s.trackingState).where(eq(s.trackingState.mediaId,mediaId)))[0].playCount).toBe(205);
  expect((await db.select().from(s.trackingState).where(eq(s.trackingState.mediaId,absentId)))[0].watched).toBe(false);
  expect(reads.filter(page=>page===1)).toHaveLength(1);
  [stage]=await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id));
  expect(stage.phase).toBe('done');
  expect(await db.select().from(s.traktImportRecords).where(eq(s.traktImportRecords.stageId,stage.id))).toHaveLength(0);
  await execute(id,adapter);expect(await db.select().from(s.trackingEvents).where(eq(s.trackingEvents.mediaId,mediaId))).toHaveLength(205);
  await db.update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,id));
  expect(await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id))).toHaveLength(0);
},30_000);

run('changed provider activity restarts incomplete census before applying observations',async()=>{
  const db=getDb(),id=await action();let activity='first',pages=0;
  const adapter=new TraktAdapter(async(path)=>{
    if(path==='/sync/last_activities')return{all:activity};
    const page=Number(new URL(path,'https://fixture.invalid').searchParams.get('page'));pages++;
    if(page===1)return Array.from({length:100},(_,index)=>({id:500+index,watched_at:date(500+index),movie}));
    activity='second';return[];
  },'client','secret');
  await expect(execute(id,adapter,4)).rejects.toBeInstanceOf(JobYield);
  await expect(execute(id,adapter,4)).rejects.toBeInstanceOf(JobYield);
  const [stage]=await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id));
  expect(stage).toMatchObject({phase:'fetching',nextPage:1,restarts:1,activity:'second'});
  expect(await db.select().from(s.traktImportRecords).where(eq(s.traktImportRecords.stageId,stage.id))).toHaveLength(0);
  expect(pages).toBe(2);
  await db.update(s.outboxActions).set({state:'cancelled'}).where(eq(s.outboxActions.id,id));
  expect(await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id))).toHaveLength(0);
});

run('synthetic 2,000-event history completes in bounded chunks and retains every event',async()=>{
  const id=await action(),count=2000,all=Array.from({length:count},(_,index)=>({id:10_000+count-index,watched_at:date(10_000+count-index),movie}));
  let pages=0;
  const adapter=new TraktAdapter(async(path)=>{
    if(path==='/sync/last_activities')return{all:'benchmark-stable'};
    const page=Number(new URL(path,'https://fixture.invalid').searchParams.get('page'));pages++;
    return all.slice((page-1)*100,page*100);
  },'client','secret');
  const durations:number[]=[],started=performance.now();let yields=0,maxPages=0,complete=false;
  for(let chunks=0;chunks<100;chunks++){
    const before=pages,start=performance.now();
    try{await execute(id,adapter);complete=true;}catch(error){if(!(error instanceof JobYield))throw error;yields++;}
    durations.push(performance.now()-start);maxPages=Math.max(maxPages,pages-before);
    if(complete)break;
  }
  expect(complete).toBe(true);expect(pages).toBe(21);expect(maxPages).toBeLessThanOrEqual(5);expect(yields).toBeGreaterThan(20);
  const [events]=await getDb().execute<{count:number}>(sql`select count(*)::int as count from tracking_events where user_id=${userId} and source='trakt' and source_event_id like ${`${connectionId}:history:1____:%`}`);
  expect(events.count).toBe(count);
  const sorted=[...durations].sort((a,b)=>a-b);
  console.info(JSON.stringify({benchmark:'trakt-history-2000',elapsedMs:Math.round(performance.now()-started),chunks:durations.length,yields,historyPageCalls:pages,maxPageCallsPerChunk:maxPages,medianChunkMs:Math.round(sorted[Math.floor(sorted.length/2)]),maxChunkMs:Math.round(Math.max(...durations))}));
  await getDb().update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,id));
},90_000);

run('repeated activity changes back off with a fresh fence and a stable retry can converge',async()=>{
  const db=getDb(),id=await action();let version=0,changing=true;
  const adapter=new TraktAdapter(async(path)=>path==='/sync/last_activities'?{all:String(changing?++version:version)}:[],'client','secret');
  for(let restart=0;restart<3;restart++)await expect(execute(id,adapter,4)).rejects.toBeInstanceOf(JobYield);
  await expect(execute(id,adapter,4)).rejects.toThrow('changed repeatedly');
  const [stage]=await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id));
  expect(stage).toMatchObject({phase:'fetching',nextPage:1,restarts:0,activity:String(version)});
  expect((await db.select().from(s.trackingState).where(eq(s.trackingState.mediaId,mediaId)))[0].watched).toBe(true);
  changing=false;
  for(let chunk=0;chunk<10;chunk++){
    try{await execute(id,adapter);break;}catch(error){if(!(error instanceof JobYield))throw error;}
  }
  expect((await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id)))[0].phase).toBe('done');
  await db.update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,id));
});

run('staging is removed on reconnect, connection deletion and stale non-running retention',async()=>{
  const db=getDb();
  const seed=async(id:string)=>{
    const [stage]=await db.insert(s.traktImportStages).values({actionId:id,connectionId,accountGeneration:generation,category:'history',activity:'stable'}).returning();
    await db.insert(s.traktImportRecords).values({stageId:stage.id,ordinal:0,sortKey:'',record:{movie}});return stage;
  };
  let id=await action();await seed(id);
  await db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,connectionId));
  expect(await db.select().from(s.traktImportStages)).toHaveLength(0);expect(await db.select().from(s.traktImportRecords)).toHaveLength(0);
  await db.update(s.providerConnections).set({status:'connected'}).where(eq(s.providerConnections.id,connectionId));
  await db.update(s.outboxActions).set({state:'cancelled'}).where(eq(s.outboxActions.id,id));
  id=await action();await seed(id);
  generation=crypto.randomUUID();
  await db.update(s.providerConnections).set({accountGeneration:generation}).where(eq(s.providerConnections.id,connectionId));
  expect(await db.select().from(s.traktImportStages)).toHaveLength(0);
  const adapter=new TraktAdapter(async()=>({all:'stable'}),'client','secret');
  await expect(execute(id,adapter)).rejects.toThrow('execution changed');
  await db.update(s.outboxActions).set({state:'cancelled'}).where(eq(s.outboxActions.id,id));
  id=await action();const stage=await seed(id);
  await db.update(s.traktImportStages).set({updatedAt:sql`now()-interval '31 days'`}).where(eq(s.traktImportStages.id,stage.id));
  await pruneTransientRecords();expect(await db.select().from(s.traktImportStages)).toHaveLength(1);
  await db.update(s.outboxActions).set({state:'failed'}).where(eq(s.outboxActions.id,id));
  await pruneTransientRecords();expect(await db.select().from(s.traktImportStages)).toHaveLength(0);
  id=await action();await seed(id);
  await db.delete(s.providerConnections).where(eq(s.providerConnections.id,connectionId));
  expect(await db.select().from(s.traktImportStages)).toHaveLength(0);expect(await db.select().from(s.traktImportRecords)).toHaveLength(0);
});
