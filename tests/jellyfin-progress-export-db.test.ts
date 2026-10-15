import {afterAll,beforeAll,expect,test} from 'bun:test';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {trackWithExports,bulkTrackWithExports} from '../src/lib/sync/changes.server';
import {track} from '../src/lib/core/tracking/service.server';
import {executeJellyfinUserState,type JellyfinSyncContext} from '../src/lib/sync/jellyfin.server';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const userIds:string[]=[],instanceIds:string[]=[],workIds:string[]=[];
let original:Awaited<ReturnType<typeof getConfig>>;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;original=await getConfig();
 await getDb().insert(s.systemSettings).values({key:'coast',value:{...original,developerMode:true}})
  .onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...original,developerMode:true}}});
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;const db=getDb();
 if(userIds.length)await db.delete(s.users).where(inArray(s.users.id,userIds));
 if(instanceIds.length)await db.delete(s.providerInstances).where(inArray(s.providerInstances.id,instanceIds));
 if(workIds.length)await db.delete(s.works).where(inArray(s.works.id,workIds));
 await db.update(s.systemSettings).set({value:original}).where(eq(s.systemSettings.key,'coast'));
});
async function fixture(){
 const db=getDb(),tag=crypto.randomUUID(),remote=new Map<string,number>(),writes:{externalId:string;ticks:number}[]=[],paths:string[]=[];
 const [user]=await db.insert(s.users).values({username:`progress-export-${tag}`}).returning();userIds.push(user.id);
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();instanceIds.push(instance.id);
 // Explicit mapped edits must work independently of both automatic options.
 const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:tag,credentials:'fixture',settings:{importPlayback:false,reconcileTracking:false}}).returning();
 const adapter=new JellyfinAdapter(async(path,init)=>{
  paths.push(path);const url=new URL(path,'https://fixture.invalid');
  if(url.pathname==='/System/Info/Public')return {Id:tag,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'10.11.0'};
  if(url.pathname.startsWith(`/Users/${tag}/Items/`)){
   const externalId=url.pathname.split('/').at(-1)!;
   if(!remote.has(externalId))throw new Error('Unexpected item lookup');
   return {Id:externalId,Type:'Movie',Name:'Progress export',UserData:{Played:false,IsFavorite:false,PlayCount:0,PlaybackPositionTicks:remote.get(externalId)!*10000000}};
  }
  if(url.pathname.startsWith('/UserItems/')&&url.pathname.endsWith('/UserData')&&init?.method==='POST'){
   expect(url.searchParams.get('userId')).toBe(tag);
   const externalId=url.pathname.split('/')[2],body=JSON.parse(String(init.body));
   expect(Object.keys(body)).toEqual(['PlaybackPositionTicks']);
   expect(typeof body.PlaybackPositionTicks).toBe('number');
   writes.push({externalId,ticks:body.PlaybackPositionTicks});remote.set(externalId,body.PlaybackPositionTicks/10000000);return {};
  }
  throw new Error(`Unexpected progress delivery endpoint: ${url.pathname}`);
 },user.id,'synthetic');
 const context:JellyfinSyncContext={adapter,instance,connection};
 async function movie(position=0,duration=1200){
  const externalId=crypto.randomUUID().replaceAll('-','');
  const [work]=await db.insert(s.media).values({kind:'movie',title:`Progress ${externalId}`}).returning();workIds.push(work.id);
  await db.insert(s.movies).values({mediaId:work.id});
  const [item]=await db.insert(s.providerItems).values({instanceId:instance.id,mediaId:work.id,externalId,kind:'movie'}).returning();
  await db.insert(s.availability).values({userId:user.id,connectionId:connection.id,providerItemId:item.id,mediaId:work.id,sourceId:'default',state:'available'});
  remote.set(externalId,position);
  if(position){
   await track(user.id,{mediaId:work.id,action:'progress',positionSeconds:position,durationSeconds:duration,acknowledged:true});
   await db.insert(s.syncValues).values({connectionId:connection.id,mediaId:work.id,category:'progress',remote:{positionSeconds:position,durationSeconds:duration},agreed:{positionSeconds:position,durationSeconds:duration}});
  }
  return {id:work.id,externalId};
 }
 async function deliver(work:{id:string;externalId:string},position:number,duration:number){
  const [intent]=await db.select().from(s.reconciliationIntents).where(and(eq(s.reconciliationIntents.connectionId,connection.id),eq(s.reconciliationIntents.workId,work.id),eq(s.reconciliationIntents.category,'progress')));
  expect(intent.value).toEqual({positionSeconds:position,durationSeconds:duration});
  const [job]=await db.select().from(s.outboxActions).where(and(eq(s.outboxActions.connectionId,connection.id),eq(s.outboxActions.kind,'jellyfin.user-state'),eq(s.outboxActions.state,'pending'),sql`${s.outboxActions.payload}->>'mediaId'=${work.id}`)).orderBy(desc(s.outboxActions.createdAt)).limit(1);
  expect(job.accountGeneration).toBe(connection.accountGeneration);
  expect(job.payload).toMatchObject({field:'progress',value:position,durationSeconds:duration,intentVersion:intent.version,backfill:false});
  expect(typeof job.payload.value).toBe('number');
  const before=writes.length;await executeJellyfinUserState(user.id,connection.id,job.payload,context);
  expect(writes.slice(before)).toEqual([{externalId:work.externalId,ticks:position*10000000}]);
  expect(await db.select().from(s.reconciliationIntents).where(and(eq(s.reconciliationIntents.connectionId,connection.id),eq(s.reconciliationIntents.workId,work.id),eq(s.reconciliationIntents.category,'progress')))).toHaveLength(0);
  await db.update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,job.id));
 }
 return {user,connection,movie,deliver,writes,paths};
}

run('manual nonzero progress and zero reset preserve numeric intent, payload and exact Jellyfin ticks',async()=>{
 const f=await fixture(),work=await f.movie();
 const changed=await trackWithExports(f.user.id,{mediaId:work.id,action:'progress',positionSeconds:300,durationSeconds:1200,acknowledged:true});
 expect(changed.changed).toBe(true);expect(changed.state.positionSeconds).toBe(300);
 await f.deliver(work,300,1200);
 // The UI reset omits duration; the committed duration must survive into delivery.
 const reset=await trackWithExports(f.user.id,{mediaId:work.id,action:'progress',positionSeconds:0,acknowledged:true});
 expect(reset.changed).toBe(true);expect(reset.state.positionSeconds).toBe(0);
 await f.deliver(work,0,1200);
 expect(f.writes.map(write=>write.ticks)).toEqual([3000000000,0]);
 expect(f.paths.some(path=>path.startsWith('/Sessions/'))).toBe(false);
 expect(await getDb().select().from(s.playbackSessions).where(eq(s.playbackSessions.userId,f.user.id))).toHaveLength(0);
});

run('bulk collection progress reset exports each committed zero with that titles retained duration',async()=>{
 const f=await fixture(),one=await f.movie(300,1200),two=await f.movie(450,1800),db=getDb();
 const [parent]=await db.insert(s.media).values({kind:'collection',title:'Progress group'}).returning();workIds.push(parent.id);
 await db.insert(s.mediaRelationships).values([{parentId:parent.id,childId:one.id,kind:'collection',position:0},{parentId:parent.id,childId:two.id,kind:'collection',position:1}]);
 const result=await bulkTrackWithExports(f.user.id,{mediaId:parent.id,action:'progress',acknowledged:true});
 expect(result.changed).toBe(2);expect(result.events.map(event=>event.mediaId).sort()).toEqual([one.id,two.id].sort());
 await f.deliver(one,0,1200);await f.deliver(two,0,1800);
 expect(f.writes.map(write=>write.ticks)).toEqual([0,0]);
 const states=await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,f.user.id),inArray(s.trackingState.mediaId,[one.id,two.id])));
 expect(states.every(state=>state.positionSeconds===0)).toBe(true);
});
