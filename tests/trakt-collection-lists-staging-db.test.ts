import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { ingestMetadata } from '../src/lib/catalogue/service.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { importTraktFromAdapter } from '../src/lib/sync/trakt-import.server';
import { reconcileProviderValue } from '../src/lib/sync/values.server';
import { reconcileProviderList } from '../src/lib/sync/list-values.server';
import { jobExecution, JobYield } from '../src/lib/server/queue/execution';
import type { SyncPreferences } from '../src/lib/providers/contracts';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip,tag=crypto.randomUUID(),base=1890000000;
let userId:string,instanceId:string,connection:typeof s.providerConnections.$inferSelect,movieId:string,absentId:string;
const sync:SyncPreferences={history:false,progress:false,ratings:false,watchlist:false,collection:false,lists:false,scrobble:false};
const movie={title:'Paged collection movie',ids:{trakt:base}},show={title:'Paged collection show',ids:{trakt:base+1}};
const execute=(id:string,adapter:TraktAdapter,preferences:SyncPreferences,checkpoints=0)=>jobExecution.run({id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints},()=>importTraktFromAdapter(userId,connection.id,{adapter,sync:preferences}));
const action=async(kind='trakt.import')=>(await getDb().insert(s.outboxActions).values({userId,connectionId:connection.id,accountGeneration:connection.accountGeneration,kind,payload:{},state:'running',attempts:1}).returning())[0].id;
async function finish(id:string,adapter:TraktAdapter,preferences:SyncPreferences){
  for(let chunk=0;chunk<100;chunk++){
    try{await execute(id,adapter,preferences);return;}catch(error){if(!(error instanceof JobYield))throw error;}
  }
  throw new Error('Fixture import did not finish in bounded chunks.');
}
beforeAll(async()=>{
  if(!enabled)return;
  [userId]=(await getDb().insert(s.users).values({username:`trakt-pages-${tag}`}).returning()).map(row=>row.id);
  [instanceId]=(await getDb().insert(s.providerInstances).values({provider:'trakt',name:tag,baseUrl:'https://fixture.invalid'}).returning()).map(row=>row.id);
  [connection]=await getDb().insert(s.providerConnections).values({userId,instanceId,externalUserId:tag,settings:{sync}}).returning();
  movieId=(await ingestMetadata({provider:'trakt',externalId:String(base),kind:'movie',title:movie.title})).id;
  absentId=(await ingestMetadata({provider:'trakt',externalId:String(base+2),kind:'movie',title:'Absent collection movie'})).id;
});
afterAll(async()=>{
  if(!enabled)return;
  await getDb().delete(s.users).where(eq(s.users.id,userId));await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id,instanceId));
  const roots=await getDb().execute<{id:string}>(sql`select distinct media_id as id from external_ids where provider='trakt' and external_id like '18900%'`);
  for(const {id} of roots){await getDb().delete(s.media).where(eq(s.media.id,id));await getDb().delete(s.works).where(eq(s.works.id,id));}
});

run('movie and show pages resume; episode application yields; generated entries and incomplete absence are preserved',async()=>{
  const id=await action(),preferences={...sync,collection:true};let fail=false;
  const reads:string[]=[];
  const adapter=new TraktAdapter(async(path)=>{
    const url=new URL(path,'https://fixture.invalid'),page=Number(url.searchParams.get('page')??1);
    if(url.pathname==='/sync/last_activities')return{all:'stable'};
    reads.push(`${url.pathname}:${page}`);
    if(url.pathname==='/sync/collection/movies'){
      if(page===2&&fail)throw new Error('Interrupted collection page');
      return page===1?Array.from({length:100},()=>({movie})):[];
    }
    if(url.pathname==='/sync/collection/shows'){
      expect(url.searchParams.get('limit')).toBe('10');
      return[{show,seasons:[{number:1,episodes:Array.from({length:250},(_,index)=>({number:index+1}))}]}];
    }
    throw new Error(`Unexpected endpoint ${path}`);
  },'client','secret');
  await reconcileProviderValue(userId,connection.id,absentId,'collection',{value:true},{source:'trakt'});
  await getDb().insert(s.collectionProjectionEntries).values({accountId:connection.syncAccountId!,workId:movieId,attribution:'coast-added',remote:{}});
  await expect(execute(id,adapter,preferences,4)).rejects.toBeInstanceOf(JobYield);
  fail=true;await expect(execute(id,adapter,preferences)).rejects.toThrow('Interrupted collection page');fail=false;
  expect((await getDb().select().from(s.trackingState).where(eq(s.trackingState.mediaId,absentId)))[0].collected).toBe(true);
  await expect(execute(id,adapter,preferences,4)).rejects.toBeInstanceOf(JobYield);
  const [mid]=await getDb().select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id));expect(mid.nextPage).toBe(-1);
  await expect(execute(id,adapter,preferences,4)).rejects.toBeInstanceOf(JobYield);
  await finish(id,adapter,preferences);
  const states=await getDb().select().from(s.trackingState).where(eq(s.trackingState.userId,userId));
  expect(states.filter(state=>state.collected)).toHaveLength(250);
  expect(states.some(state=>state.mediaId===movieId)).toBe(false);
  expect(states.find(state=>state.mediaId===absentId)?.collected).toBe(false);
  expect(reads.filter(read=>read==='/sync/collection/movies:1')).toHaveLength(1);
  expect(reads.filter(read=>read==='/sync/collection/shows:1')).toHaveLength(1);
  const events=await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId,userId));
  await execute(id,adapter,preferences);expect(await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId,userId))).toHaveLength(events.length);
  await getDb().update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,id));
},30_000);

run('list header and member pages survive interruption without partial replacement or false list deletion',async()=>{
  const db=getDb(),id=await action('trakt.lists-import'),preferences={...sync,lists:true};let fail=false;
  const remoteId=base+100,headers=Array.from({length:101},(_,index)=>({name:`Paged list ${index}`,ids:{trakt:remoteId+index,slug:`list-${index}`}}));
  const records=Array.from({length:1005},(_,index)=>({movie:{title:`List movie ${index}`,ids:{trakt:base+10000+index}}}));
  const [target]=await db.insert(s.lists).values({userId,name:headers[0].name,source:'trakt',sourceAccountId:connection.syncAccountId,sourceConnectionId:connection.id,externalId:String(remoteId)}).returning();
  const [absent]=await db.insert(s.lists).values({userId,name:'Absent remote list',source:'trakt',sourceAccountId:connection.syncAccountId,sourceConnectionId:connection.id,externalId:String(remoteId-1)}).returning();
  await db.insert(s.lists).values(headers.slice(1).map(remote=>({userId,name:remote.name,playlist:true,source:'trakt',sourceAccountId:connection.syncAccountId,sourceConnectionId:connection.id,externalId:String(remote.ids.trakt)})));
  await reconcileProviderList(userId,connection.id,target.id,{name:target.name,description:'',items:[absentId]},true);
  await reconcileProviderList(userId,connection.id,absent.id,{name:absent.name,description:'',items:[movieId]},true);
  const reads:string[]=[];
  const adapter=new TraktAdapter(async(path)=>{
    const url=new URL(path,'https://fixture.invalid'),page=Number(url.searchParams.get('page')??1);
    if(url.pathname==='/sync/last_activities')return{all:'stable'};
    reads.push(`${url.pathname}:${page}`);
    if(url.pathname==='/users/me/lists')return headers.slice((page-1)*100,page*100);
    if(url.pathname.includes(`/lists/${remoteId}/items/`)){
      if(page===2&&fail)throw new Error('Interrupted list member page');
      return records.slice((page-1)*100,page*100);
    }
    throw new Error(`Unexpected endpoint ${path}`);
  },'client','secret');
  for(let page=0;page<3;page++)await expect(execute(id,adapter,preferences,4)).rejects.toBeInstanceOf(JobYield);
  fail=true;await expect(execute(id,adapter,preferences)).rejects.toThrow('Interrupted list member page');fail=false;
  expect((await db.select().from(s.listItems).where(eq(s.listItems.listId,target.id))).map(row=>row.mediaId)).toEqual([absentId]);
  expect((await db.select().from(s.syncListValues).where(eq(s.syncListValues.listId,absent.id)))[0].remote.deleted).toBeUndefined();
  await finish(id,adapter,preferences);
  const members=await db.select({externalId:s.externalIds.externalId}).from(s.listItems).innerJoin(s.externalIds,and(eq(s.externalIds.mediaId,s.listItems.mediaId),eq(s.externalIds.provider,'trakt'))).where(eq(s.listItems.listId,target.id)).orderBy(asc(s.listItems.position));
  expect(members.map(member=>member.externalId)).toEqual(records.map(record=>String(record.movie.ids.trakt)));
  expect((await db.select().from(s.syncListValues).where(eq(s.syncListValues.listId,absent.id)))[0].remote.deleted).toBe(true);
  expect(reads.filter(read=>read==='/users/me/lists:1')).toHaveLength(1);expect(reads.filter(read=>read==='/users/me/lists:2')).toHaveLength(1);
  expect(reads.filter(read=>read.includes(`/lists/${remoteId}/items/`)&&read.endsWith(':1'))).toHaveLength(1);
  const before=reads.length;await execute(id,adapter,preferences);expect(reads.length).toBe(before);
  await db.update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,id));
  expect(await db.select().from(s.traktImportStages).where(eq(s.traktImportStages.actionId,id))).toHaveLength(0);
},30_000);

run('a local edit to a newly imported list between member pages remains on the conflict path',async()=>{
  const db=getDb(),id=await action('trakt.lists-import'),preferences={...sync,lists:true},remoteId=base+999;
  const records=Array.from({length:205},(_,index)=>({movie:{title:`List movie ${index}`,ids:{trakt:base+10000+index}}}));
  const adapter=new TraktAdapter(async(path)=>{
    const url=new URL(path,'https://fixture.invalid'),page=Number(url.searchParams.get('page')??1);
    if(url.pathname==='/sync/last_activities')return{all:'changed-list-stable'};
    if(url.pathname==='/users/me/lists')return[{name:'Newly imported fixture',ids:{trakt:remoteId,slug:'fixture'}}];
    if(url.pathname.includes(`/lists/${remoteId}/items/`))return records.slice((page-1)*100,page*100);
    throw new Error(`Unexpected endpoint ${path}`);
  },'client','secret');
  await expect(execute(id,adapter,preferences,4)).rejects.toBeInstanceOf(JobYield);
  await expect(execute(id,adapter,preferences,4)).rejects.toBeInstanceOf(JobYield);
  const [target]=await db.select().from(s.lists).where(and(eq(s.lists.sourceConnectionId,connection.id),eq(s.lists.externalId,String(remoteId))));
  await db.insert(s.listItems).values({listId:target.id,mediaId:absentId,position:0});
  await finish(id,adapter,preferences);
  const local=await db.select().from(s.listItems).where(eq(s.listItems.listId,target.id));
  expect(local).toHaveLength(1);expect(local.some(item=>item.mediaId===absentId)).toBe(true);
  expect((await db.select().from(s.syncListValues).where(eq(s.syncListValues.listId,target.id)))[0].conflict).toBe(true);
  await db.update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,id));
},30_000);
