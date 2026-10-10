import {beforeAll,afterAll,expect,test} from 'bun:test';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {applyCompanionPage,applyCompanionDelta} from '../src/lib/providers/jellyfin/updates.server';
import {syncJellyfinChanges,type JellyfinSyncContext} from '../src/lib/sync/jellyfin.server';
import type {CompanionPage} from '../src/lib/providers/jellyfin/companion';
import type {OutboxAction} from '../src/lib/server/queue';
import {jobExecution} from '../src/lib/server/queue/execution';
import {encryptCredential} from '../src/lib/server/security/credentials';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const tag=crypto.randomUUID(),server='d'.repeat(32),epoch='e'.repeat(32),external=['a'.repeat(32),'b'.repeat(32),'c'.repeat(32)];
let instance:typeof s.providerInstances.$inferSelect,accounts:(typeof s.providerConnections.$inferSelect)[]=[],userIds:string[]=[],works:string[]=[],oldConfig:Record<string,unknown>|null=null;
const calls:string[]=[];
let allowed=true;
const adapter=new JellyfinAdapter(async(path)=>{
 const url=new URL(path,'https://fixture.invalid');calls.push(path);
 if(url.pathname==='/System/Info/Public')return {Id:server,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'12.0.0'};
 if(url.pathname==='/Users/Me')return {Id:accounts[1].externalUserId,ServerId:server,Policy:{MaxParentalRating:1}};
 if(url.pathname==='/Items'){
  const ids=(url.searchParams.get('ids')??'').split(',');
  if(!url.searchParams.has('ids'))return {Items:[],TotalRecordCount:0,StartIndex:0};
  const items=allowed?ids.filter(id=>external.includes(id)).map(Id=>({Id,Type:'Movie',Name:'Changed movie',UserData:{Played:true,PlayCount:1,IsFavorite:true,PlaybackPositionTicks:0,LastPlayedDate:'2026-10-06T20:00:00Z'}})):[];
  return {Items:items,TotalRecordCount:items.length,StartIndex:0};
 }
 throw new Error(`Unexpected incremental request ${path}`);
},tag,'fixture');
async function context(index=0):Promise<JellyfinSyncContext>{
 const db=getDb();[instance]=await db.select().from(s.providerInstances).where(eq(s.providerInstances.id,instance.id));
 [accounts[index]]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,accounts[index].id));
 return {adapter,instance,connection:accounts[index]};
}
async function action():Promise<OutboxAction>{const [job]=await getDb().insert(s.outboxActions).values({userId:userIds[0],connectionId:accounts[0].id,kind:'jellyfin.updates',state:'running',attempts:1,payload:{}}).returning();return job;}
const page=(patch:Partial<CompanionPage>={}):CompanionPage=>({protocol:1,serverId:server,epoch,cursor:0,reset:true,more:false,changes:[],sessions:[],...patch});
beforeAll(async()=>{
 if(!enabled)return;const db=getDb();
 const [config]=await db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'coast'));oldConfig=(config?.value as Record<string,unknown>)??null;
 await db.insert(s.systemSettings).values({key:'coast',value:{...oldConfig,experimentalMusic:false}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...oldConfig,experimentalMusic:false}}});
 for(let n=0;n<2;n++){const [user]=await db.insert(s.users).values({username:`companion-${tag}-${n}`,role:n?'user':'admin'}).returning();userIds.push(user.id);}
 [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:server,settings:{schedule:{enabled:true,intervalMinutes:10,fullIntervalHours:24},screenLibraryCensus:{test:{complete:true}}}}).returning();
 for(let n=0;n<2;n++){const [account]=await db.insert(s.providerConnections).values({userId:userIds[n],instanceId:instance.id,externalUserId:String(n+1).repeat(32),credentials:'fixture',settings:{importPlayback:true}}).returning();accounts.push(account);}
 for(const externalId of external){const [work]=await db.insert(s.media).values({kind:'movie',title:`companion-${externalId}-${tag}`}).returning();works.push(work.id);await db.insert(s.movies).values({mediaId:work.id});
  const [item]=await db.insert(s.providerItems).values({instanceId:instance.id,mediaId:work.id,externalId,kind:'movie'}).returning();
  for(let n=0;n<2;n++)await db.insert(s.availability).values({userId:userIds[n],connectionId:accounts[n].id,providerItemId:item.id,mediaId:work.id,sourceId:'default',state:'available',verifiedAt:new Date(Date.now()-86400000)});
 }
});
afterAll(async()=>{if(!enabled||!instance)return;const db=getDb();for(const id of userIds)await db.delete(s.users).where(eq(s.users.id,id));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,instance.id));await db.delete(s.media).where(inArray(s.media.id,works));if(oldConfig)await db.update(s.systemSettings).set({value:oldConfig}).where(eq(s.systemSettings.key,'coast'));else await db.delete(s.systemSettings).where(eq(s.systemSettings.key,'coast'));});
run('reset stages baseline work durably, invalidates census and keeps polling until it completes',async()=>{
 await applyCompanionPage(await action(),await context(),page());
 const current=await context();expect(current.instance.settings.screenLibraryCensus).toBeUndefined();expect(current.instance.settings.companion).toMatchObject({epoch,cursor:0,status:'reconciling'});
 const jobs=await getDb().select().from(s.outboxActions).where(inArray(s.outboxActions.kind,['jellyfin.library','jellyfin.sync']));expect(jobs).toHaveLength(3);
 for(const job of jobs)await getDb().update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,job.id));
 await applyCompanionPage(await action(),await context(),page({reset:false}));
 expect((await context()).instance.settings.companion).toMatchObject({status:'healthy',baselineIds:[]});
});
run('personal events enqueue only their account, and acknowledgement commits with the jobs',async()=>{
 const data=page({reset:false,cursor:1,changes:[{Sequence:1,Kind:'user-data',UserId:accounts[1].externalUserId,ItemId:external[0],ItemType:'Movie'}],sessions:[{Id:'stream',UserId:accounts[1].externalUserId,UserName:'Friend',NowPlayingItem:{Id:external[0],Name:'Movie',Type:'Movie'},PlayState:{IsPaused:false,PositionTicks:10000000}}]});
 await applyCompanionPage(await action(),await context(),data);
 const jobs=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'jellyfin.delta'));expect(jobs).toHaveLength(1);expect(jobs[0].connectionId).toBe(accounts[1].id);
 const [live]=await getDb().select().from(s.socialLiveState).where(eq(s.socialLiveState.connectionId,accounts[1].id));expect(live.workId).toBe(works[0]);
 const [scan]=await getSql()`select * from server_stream_scans where instance_id=${instance.id}`;expect(scan.last_error).toBeNull();
 const before=jobs.length;await expect(applyCompanionPage(await action(),await context(),data)).rejects.toThrow('out of order');
 expect(await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'jellyfin.delta'))).toHaveLength(before);
 expect((await context()).instance.settings.companion).toMatchObject({cursor:1});
});
run('incremental item imports never touch full cursors or remove unrelated availability',async()=>{
 const db=getDb(),scanId=crypto.randomUUID();
 await db.insert(s.syncCheckpoints).values({connectionId:accounts[1].id,kind:'jellyfin-user',cursor:'100',scanId});
 const checkpoint=(await db.select().from(s.syncCheckpoints).where(eq(s.syncCheckpoints.connectionId,accounts[1].id)))[0];
 calls.length=0;await syncJellyfinChanges(userIds[1],accounts[1].id,'user',{video:[external[0]],music:[]},await context(1));
 expect(calls.filter(call=>call.startsWith('/Items?'))).toHaveLength(1);expect(calls.some(call=>call.includes('ids='+external[0]))).toBe(true);
 expect((await db.select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,accounts[1].id),eq(s.syncCheckpoints.kind,'jellyfin-user'))))[0]).toEqual(checkpoint);
 const [providerItem]=await db.select().from(s.providerItems).where(and(eq(s.providerItems.instanceId,instance.id),eq(s.providerItems.externalId,external[0])));
 await db.insert(s.availability).values({userId:userIds[1],connectionId:accounts[1].id,providerItemId:providerItem.id,mediaId:works[0],sourceId:'removed-edition',state:'available'});
 const tracking=(await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,userIds[1]),eq(s.trackingState.mediaId,works[0]))))[0];expect(tracking.watched).toBe(true);expect(tracking.favourite).toBe(true);
 await syncJellyfinChanges(userIds[1],accounts[1].id,'user',{video:[external[0]],music:[]},await context(1));
 const [oldEdition]=await db.select().from(s.availability).where(and(eq(s.availability.connectionId,accounts[1].id),eq(s.availability.sourceId,'removed-edition')));expect(oldEdition.state).toBe('unavailable');
 expect(await db.select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId,userIds[1]),eq(s.trackingEvents.mediaId,works[0]),eq(s.trackingEvents.action,'watch')))).toHaveLength(1);
 allowed=false;try{await syncJellyfinChanges(userIds[1],accounts[1].id,'user',{video:[external[0]],music:[]},await context(1));}finally{allowed=true;}
 const access=await db.select().from(s.availability).where(eq(s.availability.connectionId,accounts[1].id));expect(access.find(a=>a.mediaId===works[0])?.state).toBe('unavailable');expect(access.find(a=>a.mediaId===works[1])?.state).toBe('available');
});
run('large change jobs yield after committed batches and resume without requesting completed IDs',async()=>{
 const db=getDb(),items=Array.from({length:130},(_,index)=>(index+1000).toString(16).padStart(32,'0'));
 await db.update(s.providerConnections).set({credentials:await encryptCredential(JSON.stringify({accessToken:'fixture'}))}).where(eq(s.providerConnections.id,accounts[1].id));
 const [job]=await db.insert(s.outboxActions).values({userId:userIds[1],connectionId:accounts[1].id,accountGeneration:accounts[1].accountGeneration,
  kind:'jellyfin.delta',state:'running',attempts:1,payload:{scope:'user',video:items,music:[]}}).returning();
 const identity=JellyfinAdapter.prototype.identity,lookup=JellyfinAdapter.prototype.items;
 JellyfinAdapter.prototype.identity=function(expected){return identity.call(adapter,expected);};
 JellyfinAdapter.prototype.items=function(userId,ids){return lookup.call(adapter,userId,ids);};
 const execute=()=>jobExecution.run({id:job.id,attempts:1,purpose:'live',started:performance.now(),checkpoints:0},()=>applyCompanionDelta(job));
 try{
  calls.length=0;await expect(execute()).rejects.toThrow('yielded');
  const [saved]=await db.select().from(s.outboxActions).where(eq(s.outboxActions.id,job.id));expect(saved.payload._checkpoint).toMatchObject({offset:125});
  const first=calls.filter(call=>call.startsWith('/Items?'));expect(first).toHaveLength(5);
  calls.length=0;await expect(execute()).resolves.toMatchObject({checked:0,count:0,full:false});
  const resumed=calls.filter(call=>call.startsWith('/Items?'));expect(resumed).toHaveLength(1);
  expect(new URL(resumed[0],'https://fixture.invalid').searchParams.get('ids')?.split(',')).toEqual(items.slice(125));
 }finally{JellyfinAdapter.prototype.identity=identity;JellyfinAdapter.prototype.items=lookup;}
});
run('a failed acknowledgement transaction leaves the old cursor and queues no partial follow-ups',async()=>{
 const ctx=await context(),job=await action();
 const before=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'jellyfin.delta'));
 await getDb().update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,accounts[0].id));
 await expect(applyCompanionPage(job,ctx,page({reset:false,cursor:2,changes:[{Sequence:2,Kind:'item-updated',ItemId:external[1],UserId:null,ItemType:'Movie'}]}))).rejects.toThrow('source account changed');
 expect(await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'jellyfin.delta'))).toHaveLength(before.length);
 expect((await context()).instance.settings.companion).toMatchObject({cursor:1});
});
run('reconnected sources reconcile again and permission edits revoke only the affected account',async()=>{
 await applyCompanionPage(await action(),await context(),page());
 const ctx=await context();
 await applyCompanionPage(await action(),ctx,page({reset:false,cursor:1,changes:[{Sequence:1,Kind:'user-updated',ItemId:null,UserId:accounts[1].externalUserId,ItemType:null}]}));
 const own=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,accounts[0].id));expect(own.every(a=>a.state==='available')).toBe(true);
 const friend=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,accounts[1].id));expect(friend.every(a=>a.state==='unavailable')).toBe(true);
 const [point]=await getDb().select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,accounts[1].id),eq(s.syncCheckpoints.kind,'jellyfin-user')));expect(point.completedAt).toBeNull();expect(point.cursor).toBeNull();
});
run('expired workers cannot publish a snapshot or acknowledge a feed cursor',async()=>{
 const ctx=await context(),job=await action();await getDb().update(s.outboxActions).set({state:'pending',attempts:2}).where(eq(s.outboxActions.id,job.id));
 await expect(jobExecution.run({id:job.id,attempts:1,purpose:'live',started:performance.now(),checkpoints:0},()=>applyCompanionPage(job,ctx,page({reset:false,cursor:1})))).rejects.toThrow('yielded');
 expect((await context()).instance.settings.companion).toMatchObject({cursor:1});
});
