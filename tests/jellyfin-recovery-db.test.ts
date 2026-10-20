import {afterAll,beforeAll,expect,test} from 'bun:test';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {syncJellyfinUser,syncJellyfinChanges,type JellyfinSyncContext} from '../src/lib/sync/jellyfin.server';
import {observeMusicPageAccess,persistMusic} from '../src/lib/music/persistence.server';
import {importReading} from '../src/lib/catalogue/reading.server';
import {observeReadingFile} from '../src/lib/catalogue/reading-files.server';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import {enqueueAction,registerActionHandler,runQueueOnce} from '../src/lib/server/queue';
import type {ProviderTransport} from '../src/lib/providers/contracts';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let original:Awaited<ReturnType<typeof getConfig>>;
const userIds:string[]=[],instanceIds:string[]=[],workIds:string[]=[];
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;original=await getConfig();
 await getDb().insert(s.systemSettings).values({key:'coast',value:{...original,developerMode:true,experimentalMusic:true,experimentalBooks:true}})
  .onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...original,developerMode:true,experimentalMusic:true,experimentalBooks:true}}});
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;const db=getDb();
 if(userIds.length)await db.delete(s.users).where(inArray(s.users.id,userIds));
 if(instanceIds.length)await db.delete(s.providerInstances).where(inArray(s.providerInstances.id,instanceIds));
 if(workIds.length)await db.delete(s.works).where(inArray(s.works.id,workIds));
 await db.update(s.systemSettings).set({value:original}).where(eq(s.systemSettings.key,'coast'));
});
async function fixture(items:ProviderTransport){
 const db=getDb(),tag=crypto.randomUUID();
 const [user]=await db.insert(s.users).values({username:`jellyfin-recovery-${tag}`}).returning();userIds.push(user.id);
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();instanceIds.push(instance.id);
 const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:tag,credentials:'fixture',settings:{importPlayback:true}}).returning();
 const adapter=new JellyfinAdapter(async(path,init)=>{
  if(path==='/System/Info/Public')return {Id:tag,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'12.1.0'};
  return items(path,init);
 },user.id,'fixture');
 async function context():Promise<JellyfinSyncContext>{
  const [current]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));
  return {adapter,connection:current,instance};
 }
 return {user,instance,connection,context,sync:async()=>syncJellyfinUser(user.id,connection.id,undefined,await context())};
}
const empty=(offset=0)=>({Items:[],TotalRecordCount:0,StartIndex:offset});
const id=()=>crypto.randomUUID().replaceAll('-','');

run('recording copies aggregate once across pages, reversed order and a single-copy delta',async()=>{
 const mbid=crypto.randomUUID(),ids=[id(),id()];
 let tracks=[{Id:ids[0],Type:'Audio',Name:'Recording A',RunTimeTicks:900000000,ProviderIds:{MusicBrainzTrack:mbid},UserData:{IsFavorite:true,PlayCount:3,PlaybackPositionTicks:400000000}},
  {Id:ids[1],Type:'Audio',Name:'Recording B',RunTimeTicks:900000000,ProviderIds:{MusicBrainzTrack:mbid},UserData:{IsFavorite:false,PlayCount:0,PlaybackPositionTicks:0}}];
 const f=await fixture(async path=>{
  const q=new URL(path,'https://fixture.invalid').searchParams,type=q.get('includeItemTypes')??'';
  const requested=q.get('ids')?.split(','),offset=Number(q.get('startIndex')??0);
  const rows=requested?tracks.filter(item=>requested.includes(item.Id)):type==='Audio'?tracks:[];
  return {Items:rows.slice(offset,offset+(requested?100:1)),TotalRecordCount:rows.length,StartIndex:offset};
 });
 const saved=await persistMusic(f.instance.id,{id:ids[0],kind:'track',title:'Recording',artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{musicbrainztrack:mbid}});workIds.push(saved.workId!);
 await persistMusic(f.instance.id,{id:ids[1],kind:'track',title:'Recording',artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{musicbrainztrack:mbid}});
 await f.sync();tracks=tracks.toReversed();await f.sync();
 const db=getDb(),state=async()=>(await db.select().from(s.musicProgress).where(and(eq(s.musicProgress.userId,f.user.id),eq(s.musicProgress.trackId,saved.workId!))))[0];
 expect(await state()).toMatchObject({playCount:3,positionSeconds:40});
 expect(await db.select().from(s.musicListens).where(eq(s.musicListens.userId,f.user.id))).toHaveLength(3);
 expect((await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,f.user.id),eq(s.trackingState.mediaId,saved.workId!))))[0].favourite).toBe(true);
 await syncJellyfinChanges(f.user.id,f.connection.id,'user',{video:[],music:[ids[1]]},await f.context());
 expect(await state()).toMatchObject({playCount:3,positionSeconds:40});
 // A genuine complete observation can clear all copies; stable retries add no listens.
 for(const track of tracks)Object.assign(track.UserData,{IsFavorite:false,PlayCount:0,PlaybackPositionTicks:0});
 await f.sync();await f.sync();expect(await state()).toMatchObject({playCount:0,positionSeconds:0});
 expect(await db.select().from(s.musicListens).where(eq(s.musicListens.userId,f.user.id))).toHaveLength(3);
});

run('changed music page totals retain old positive access and invalidate complete coverage',async()=>{
 const rows=Array.from({length:3},(_,n)=>({Id:id(),Type:'Audio',Name:`Track ${n}`,ProviderIds:{MusicBrainzTrack:crypto.randomUUID()}}));
 let changing=false,yieldMusic=false;
 const f=await fixture(async path=>{
  const q=new URL(path,'https://fixture.invalid').searchParams,offset=Number(q.get('startIndex')??0);
  const current=changing&&offset>0?rows.slice(1):rows;
  const execution=jobExecution.getStore();if(yieldMusic&&execution&&q.get('includeItemTypes')==='Audio'&&offset===0)execution.started=performance.now()-11000;
  return q.get('includeItemTypes')==='Audio'?{Items:current.slice(offset,offset+1),TotalRecordCount:current.length,StartIndex:offset}:empty();
 });
 for(const row of rows){const saved=await persistMusic(f.instance.id,{id:row.Id,kind:'track',title:row.Name,artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{musicbrainztrack:row.ProviderIds.MusicBrainzTrack}});workIds.push(saved.workId!);}
 await f.sync();
 const db=getDb(),[job]=await db.insert(s.outboxActions).values({userId:f.user.id,connectionId:f.connection.id,accountGeneration:f.connection.accountGeneration,kind:'jellyfin.sync',state:'running',attempts:1,payload:{}}).returning();
 yieldMusic=true;await expect(jobExecution.run({id:job.id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},f.sync)).rejects.toBeInstanceOf(JobYield);
 expect((await f.context()).connection.settings.userSync).toMatchObject({phase:'music-tracks',musicOffset:1,traversalTotal:3});
 yieldMusic=false;changing=true;await expect(f.sync()).rejects.toThrow('changed during pagination');
 const [point]=await db.select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,f.connection.id),eq(s.syncCheckpoints.kind,'jellyfin-user')));
 expect(point.completedAt).toBeNull();
 expect((await db.select().from(s.availability).where(eq(s.availability.connectionId,f.connection.id))).every(row=>row.state==='available')).toBe(true);
 changing=false;await f.sync();expect((await db.select().from(s.syncCheckpoints).where(eq(s.syncCheckpoints.connectionId,f.connection.id)))[0].completedAt).not.toBeNull();
});

run('reading resume rejects changed totals and repeated earlier files before withdrawing access',async()=>{
 const rows=Array.from({length:3},(_,n)=>({Id:id(),Type:'Book',Name:`Book ${n}`,Path:`/fixture/${n}.pdf`,ProviderIds:{OpenLibrary:`OL9812398${n}W`}}));
 let mode:'clean'|'total'|'repeat'='clean';
 const f=await fixture(async path=>{
  const q=new URL(path,'https://fixture.invalid').searchParams,offset=Number(q.get('StartIndex')??0);
  if(q.get('IncludeItemTypes')!=='Book')return empty();
  const current=mode==='total'&&offset>0?rows.slice(1):mode==='repeat'&&offset>0?[rows[0],rows[0],rows[2]]:rows;
  return {Items:current.slice(offset,offset+1),TotalRecordCount:current.length,StartIndex:offset};
 });
 for(const row of rows){const work=await importReading({provider:'openlibrary',externalId:row.ProviderIds.OpenLibrary,kind:'book',title:row.Name,sourceUrl:`https://openlibrary.org/works/${row.ProviderIds.OpenLibrary}`,authors:[],subjects:[]});workIds.push(work.id);
  await observeReadingFile({userId:f.user.id,connectionId:f.connection.id,instanceId:f.instance.id,generation:f.connection.accountGeneration,workId:work.id,book:{...row,Type:'Book'},edition:'fixture',access:false});}
 await f.sync();
 const db=getDb(),[job]=await db.insert(s.outboxActions).values({userId:f.user.id,connectionId:f.connection.id,accountGeneration:f.connection.accountGeneration,kind:'jellyfin.sync',state:'running',attempts:1,payload:{}}).returning();
 for(const changed of ['total','repeat'] as const){
  // Yield with a real persisted per-file offset before changing the provider page.
  await expect(jobExecution.run({id:job.id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},f.sync)).rejects.toBeInstanceOf(JobYield);
  const [saved]=await db.select().from(s.outboxActions).where(eq(s.outboxActions.id,job.id));
  const progress=saved.payload._checkpoint as {task:string;offset:number};
  expect(progress.task).toBe('jellyfin-reading-access');expect(progress.offset).toBeGreaterThan(0);
  mode=changed;await expect(f.sync()).rejects.toThrow('changed during pagination');
  const [point]=await db.select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,f.connection.id),eq(s.syncCheckpoints.kind,'jellyfin-user')));
  expect(point.completedAt).toBeNull();expect((await db.select().from(s.availability).where(eq(s.availability.connectionId,f.connection.id))).every(row=>row.state==='available')).toBe(true);
  mode='clean';await f.sync();
 }
});

run('reset during a yielded user traversal re-reads the earlier page under the new fence',async()=>{
 const rows=Array.from({length:2},()=>({Id:id(),Type:'Movie',Name:'Reset title',UserData:{Played:false,IsFavorite:false,PlayCount:0,PlaybackPositionTicks:0}}));
 const offsets:number[]=[];
 const f=await fixture(async path=>{
  const q=new URL(path,'https://fixture.invalid').searchParams,offset=Number(q.get('startIndex')??0);
  if(q.get('includeItemTypes')!=='Movie,Series,Season,Episode')return empty();
  offsets.push(offset);const execution=jobExecution.getStore();if(execution&&offset===0)execution.started=performance.now()-11000;
  return {Items:rows.slice(offset,offset+1),TotalRecordCount:rows.length,StartIndex:offset};
 });
 const db=getDb();for(const row of rows){const [work]=await db.insert(s.media).values({kind:'movie',title:'Reset title'}).returning();workIds.push(work.id);await db.insert(s.movies).values({mediaId:work.id});await db.insert(s.providerItems).values({instanceId:f.instance.id,mediaId:work.id,externalId:row.Id,kind:'movie'});}
 const [job]=await db.insert(s.outboxActions).values({userId:f.user.id,connectionId:f.connection.id,accountGeneration:f.connection.accountGeneration,kind:'jellyfin.sync',state:'running',attempts:1,payload:{}}).returning();
 await expect(jobExecution.run({id:job.id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},f.sync)).rejects.toBeInstanceOf(JobYield);
 expect(offsets).toEqual([0]);rows[0].UserData={Played:true,IsFavorite:true,PlayCount:1,PlaybackPositionTicks:0};
 const resetId=crypto.randomUUID();await db.update(s.providerConnections).set({settings:sql`${s.providerConnections.settings}||jsonb_build_object('userSyncResetId',${resetId}::text)`}).where(eq(s.providerConnections.id,f.connection.id));
 await f.sync();expect(offsets.slice(1)).toEqual([0,1]);
 const [current]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,f.connection.id));expect(current.settings.userSync).toMatchObject({phase:'complete',resetId});
 const [first]=await db.select({state:s.trackingState}).from(s.providerItems).innerJoin(s.trackingState,and(eq(s.trackingState.mediaId,s.providerItems.mediaId),eq(s.trackingState.userId,f.user.id))).where(and(eq(s.providerItems.instanceId,f.instance.id),eq(s.providerItems.externalId,rows[0].Id)));
 expect(first.state).toMatchObject({watched:true,favourite:true});
});

run('stale music and reading publication fences reject access inside their transaction',async()=>{
 const f=await fixture(async()=>empty()),db=getDb(),resetId=crypto.randomUUID();
 await db.update(s.providerConnections).set({settings:{userSyncResetId:resetId}}).where(eq(s.providerConnections.id,f.connection.id));
 const track={id:id(),kind:'track' as const,title:'Stale track',artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{}};
 const saved=await persistMusic(f.instance.id,track);workIds.push(saved.workId!);
 await expect(observeMusicPageAccess(f.user.id,f.connection.id,f.instance.id,f.connection.accountGeneration,[track],crypto.randomUUID(),undefined,'track:0',null)).rejects.toBeInstanceOf(JobYield);
 const work=await importReading({provider:'openlibrary',externalId:'OL981239999W',kind:'book',title:'Stale book',sourceUrl:'https://openlibrary.org/works/OL981239999W',authors:[],subjects:[]});workIds.push(work.id);
 await expect(observeReadingFile({userId:f.user.id,connectionId:f.connection.id,instanceId:f.instance.id,generation:f.connection.accountGeneration,workId:work.id,book:{Id:id(),Type:'Book',Path:'/fixture/book.pdf',ProviderIds:{}},edition:'fixture',expectedResetId:null})).rejects.toBeInstanceOf(JobYield);
 expect(await db.select().from(s.availability).where(eq(s.availability.connectionId,f.connection.id))).toHaveLength(0);
});

run('worker final return queues reset follow-up only while its completed marker differs',async()=>{
 const f=await fixture(async()=>empty()),db=getDb(),resetId=crypto.randomUUID();
 let finishCurrent=false;
 registerActionHandler('jellyfin.sync',async()=>{
  await db.update(s.providerConnections).set({settings:{userSyncResetId:resetId,userSync:{phase:'complete',accountGeneration:f.connection.accountGeneration,...(finishCurrent?{resetId}:{})}}}).where(eq(s.providerConnections.id,f.connection.id));
  return {checked:1};
 });
 await enqueueAction({userId:f.user.id,connectionId:f.connection.id,kind:'jellyfin.sync',purpose:'manual',payload:{_followupFull:true}});
 expect(await runQueueOnce()).toBe(true);
 const waiting=()=>db.select().from(s.outboxActions).where(and(eq(s.outboxActions.connectionId,f.connection.id),eq(s.outboxActions.kind,'jellyfin.sync'),eq(s.outboxActions.state,'pending')));
 expect(await waiting()).toHaveLength(1);
 finishCurrent=true;const [next]=await waiting();await db.update(s.outboxActions).set({payload:{_manual:true,_jobPurpose:'manual',_followupFull:true}}).where(eq(s.outboxActions.id,next.id));
 expect(await runQueueOnce()).toBe(true);expect(await waiting()).toHaveLength(0);
});
