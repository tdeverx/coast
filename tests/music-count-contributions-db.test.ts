import {afterAll,beforeAll,expect,test} from 'bun:test';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import {getConfig} from '../src/lib/server/config';
import * as s from '../src/lib/server/db/schema';
import {logMusic,importedListenBatch} from '../src/lib/music/persistence.server';
import {removeMusicListen} from '../src/lib/music/history.server';
import {applyImportedMusicCount} from '../src/lib/music/sync-count.server';
import {reconcileProviderValue,localSyncValue} from '../src/lib/sync/values.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let config:Awaited<ReturnType<typeof getConfig>>;
const users:string[]=[],instances:string[]=[],works:string[]=[];
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb();config=await getConfig();const value={...config,experimentalMusic:true};
 await db.insert(s.systemSettings).values({key:'coast',value}).onConflictDoUpdate({target:s.systemSettings.key,set:{value}});
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb();if(users.length)await db.delete(s.users).where(inArray(s.users.id,users));
 if(instances.length)await db.delete(s.providerInstances).where(inArray(s.providerInstances.id,instances));
 if(works.length)await db.delete(s.works).where(inArray(s.works.id,works));
 await db.update(s.systemSettings).set({value:config}).where(eq(s.systemSettings.key,'coast'));
});
async function fixture(sharedAccount=false){
 const db=getDb(),userId=crypto.randomUUID(),trackId=crypto.randomUUID();users.push(userId);works.push(trackId);
 await db.insert(s.users).values({id:userId,username:userId});
 const providers=[crypto.randomUUID(),crypto.randomUUID()];instances.push(...providers);
 await db.insert(s.providerInstances).values(providers.map(id=>({id,provider:'jellyfin' as const,name:id,baseUrl:'https://fixture.invalid'})));
 let syncAccountId:string|undefined;
 if(sharedAccount){const [account]=await db.insert(s.syncAccounts).values({userId,provider:'jellyfin',serverIdentity:'same-server',externalUserId:'same-person'}).returning();syncAccountId=account.id;}
 const connections=await db.insert(s.providerConnections).values(providers.map(instanceId=>({userId,instanceId,syncAccountId}))).returning();
 await db.insert(s.works).values({id:trackId,category:'music',kind:'track'});await db.insert(s.musicWorks).values({id:trackId,kind:'track',title:'Counter contributions'});
 const observe=async(index:number,count:number)=>{
  const connection=connections[index];
  return reconcileProviderValue(userId,connection.id,trackId,'history',{value:count>0,playCount:count},{accountGeneration:connection.accountGeneration,source:'jellyfin',apply:async tx=>{
   const [baseline]=await tx.select().from(s.syncValues).where(and(eq(s.syncValues.connectionId,connection.id),eq(s.syncValues.mediaId,trackId),eq(s.syncValues.category,'history')));
   const local=await localSyncValue(tx,userId,trackId,'history');
   return applyImportedMusicCount(tx,userId,trackId,connection.syncAccountId??connection.id,Number(baseline?.remote.importedPlayCount??baseline?.remote.playCount??local.playCount??0),count);
  }});
 };
 const prefer=(index:number)=>db.update(s.users).set({settings:{syncConflictWinner:connections[index].id}}).where(eq(s.users.id,userId));
 const count=async()=>(await db.select().from(s.musicProgress).where(and(eq(s.musicProgress.userId,userId),eq(s.musicProgress.trackId,trackId))))[0]?.playCount??0;
 const history=()=>db.select().from(s.musicListens).where(and(eq(s.musicListens.userId,userId),eq(s.musicListens.trackId,trackId))).orderBy(s.musicListens.id);
 const local=()=>logMusic(userId,trackId,{batchId:crypto.randomUUID()});
 return {db,userId,trackId,connections,observe,prefer,count,history,local};
}
run('overlapping provider resets consume only imported activity and preserve independent Coast listens and lifetime history',async()=>{
 const f=await fixture();await f.observe(0,3);await f.observe(1,3);expect(await f.count()).toBe(3);
 await f.local();expect(await f.count()).toBe(4);const history=await f.history();
 await f.prefer(0);await f.observe(0,0);expect(await f.count()).toBe(1);
 await f.prefer(1);await f.observe(1,0);await f.observe(1,0);expect(await f.count()).toBe(1);expect(await f.history()).toEqual(history);
 const baselines=await f.db.select().from(s.syncValues).where(and(inArray(s.syncValues.connectionId,f.connections.map(connection=>connection.id)),eq(s.syncValues.mediaId,f.trackId),eq(s.syncValues.category,'history')));
 expect(baselines.map(row=>row.remote.activeImportedPlayCount)).toEqual([0,0]);
 await f.observe(1,1);await f.observe(1,1);expect(await f.count()).toBe(2);
 await f.prefer(0);await f.observe(0,0);expect(await f.count()).toBe(2);
 await f.prefer(1);await f.observe(1,0);expect(await f.count()).toBe(1);
});
run('two connections for the same account share import coverage and cannot clear independent Coast listens twice',async()=>{
 const f=await fixture(true);await f.observe(0,3);await f.observe(1,3);await f.local();expect(await f.count()).toBe(4);
 await f.prefer(0);await f.observe(0,0);await f.prefer(1);await f.observe(1,0);expect(await f.count()).toBe(1);
 expect(await f.history()).toHaveLength(4);
});
run('overlapping resets and inactive imported history removal cannot consume Coast activity',async()=>{
 const f=await fixture();await f.observe(0,3);await f.observe(1,3);
 const original=await f.history();const ordinal=(index:number)=>original.find(entry=>entry.batchId===importedListenBatch(f.connections[0].id,f.trackId,index))!;
 await removeMusicListen(f.userId,f.trackId,ordinal(0).id);await f.local();expect(await f.count()).toBe(3);
 await f.prefer(0);await f.observe(0,0);await f.prefer(1);await f.observe(1,0);expect(await f.count()).toBe(1);
 await f.observe(1,1);expect(await f.count()).toBe(2);
 await removeMusicListen(f.userId,f.trackId,ordinal(1).id);expect(await f.count()).toBe(2);
 const active=(await f.history()).find(entry=>entry.batchId===importedListenBatch(f.connections[1].id,f.trackId,0))!;
 await removeMusicListen(f.userId,f.trackId,active.id);expect(await f.count()).toBe(1);
 await f.observe(1,1);expect(await f.count()).toBe(1);
});
