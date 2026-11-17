import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq,inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import {getConfig} from '../src/lib/server/config';
import * as s from '../src/lib/server/db/schema';
import {updateReading,removeReadingHistory} from '../src/lib/core/reading/service.server';
import {readingHistoryData} from '../src/lib/reading/query.server';
import {prepareReading,moveReading} from '../src/lib/reading/sessions.server';
import {createGame,createPlaythrough,logGameSession,playthroughDetails,removeGameSession,updatePlaythrough} from '../src/lib/core/games/service.server';
import {logMusic,recordMusicListen,recordImportedMusicListens} from '../src/lib/music/persistence.server';
import {musicHistory,removeMusicListen,resetMusicPosition} from '../src/lib/music/history.server';
import {applyImportedMusicCount} from '../src/lib/music/sync-count.server';
import {reconcileProviderValue} from '../src/lib/sync/values.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const [owner,other,book]=Array.from({length:3},()=>crypto.randomUUID());
const [artist,track,importedTrack]=Array.from({length:3},()=>crypto.randomUUID());
const [importInstance,importAccount]=Array.from({length:2},()=>crypto.randomUUID());
let gameId:string;
beforeAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  const db=getDb(),config=await getConfig();
  const value={...config,experimentalBooks:true,experimentalGaming:true,experimentalMusic:true};
  await db.insert(s.systemSettings).values({key:'coast',value}).onConflictDoUpdate({target:s.systemSettings.key,set:{value}});
  await db.insert(s.users).values([owner,other].map(id=>({id,username:'history-'+id})));
  await db.insert(s.providerInstances).values({id:importInstance,provider:'jellyfin',name:'History source',baseUrl:'https://fixture.invalid'});
  await db.insert(s.providerConnections).values({id:importAccount,userId:owner,instanceId:importInstance});
  await db.insert(s.works).values({id:book,category:'book',kind:'book'});
  await db.insert(s.readingWorks).values({id:book,provider:'openlibrary',externalId:'OL598472W',kind:'book',title:'History book',sourceUrl:'https://fixture.invalid'});
  gameId=(await createGame({title:'History game'})).id;
  await db.insert(s.works).values([artist,track,importedTrack].map(id=>({id,category:'music',kind:id===artist?'artist' as const:'track' as const})));
  await db.insert(s.musicWorks).values([artist,track,importedTrack].map(id=>({id,kind:id===artist?'artist' as const:'track' as const,title:id})));
  await db.insert(s.musicCredits).values([track,importedTrack].map(workId=>({workId,artistId:artist,role:'artist'})));
});
afterAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  await getDb().delete(s.users).where(inArray(s.users.id,[owner,other]));
  await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id,importInstance));
  await getDb().delete(s.works).where(inArray(s.works.id,[book,artist,track,importedTrack,...(gameId?[gameId]:[])]));
});

run('music history removal is exact across artist scope, keeps position and rejects retried removed batches',async()=>{
  const db=getDb(),batchId=crypto.randomUUID();
  await logMusic(owner,track,{batchId});await logMusic(owner,track,{batchId:crypto.randomUUID()});
  await db.update(s.musicProgress).set({positionSeconds:42,durationSeconds:100}).where(eq(s.musicProgress.userId,owner));
  const history=await musicHistory(owner,artist),entry=history.items.find(item=>item.workId===track)!;
  expect(await removeMusicListen(other,artist,entry.id)).toEqual({removed:false});
  expect(await removeMusicListen(owner,importedTrack,entry.id)).toEqual({removed:false});
  expect(await removeMusicListen(owner,artist,entry.id)).toEqual({removed:true});
  expect(await removeMusicListen(owner,artist,entry.id)).toEqual({removed:false});
  const [progress]=await db.select().from(s.musicProgress).where(eq(s.musicProgress.trackId,track));
  expect(progress).toMatchObject({playCount:1,positionSeconds:42,durationSeconds:100});
  expect(await getSql()`select id from social_activity where user_id=${owner} and source_key=${'music_listens:'+entry.id}`).toHaveLength(0);
  const [tombstone]=await db.select().from(s.removedTrackingSources).where(eq(s.removedTrackingSources.userId,owner));
  const removedBatch=tombstone.sourceEventId.split(':')[1];
  expect(await db.transaction(tx=>recordMusicListen(tx,owner,track,removedBatch,'playback'))).toBeUndefined();
  expect((await musicHistory(owner,track)).total).toBe(1);
});

run('reimporting exact provider occurrences cannot resurrect a removed listen',async()=>{
  const db=getDb(),account=importAccount;
  expect(await reconcileProviderValue(owner,account,importedTrack,'history',{value:true,playCount:2},
    {apply:tx=>applyImportedMusicCount(tx,owner,importedTrack,account,0,2)})).toBe('remote');
  expect((await musicHistory(owner,importedTrack)).total).toBe(2);
  const entry=(await musicHistory(owner,importedTrack)).items[0];
  expect(await removeMusicListen(owner,importedTrack,entry.id)).toEqual({removed:true});
  expect(await db.transaction(tx=>recordImportedMusicListens(tx,owner,importedTrack,account,0,2))).toBe(0);
  expect((await musicHistory(owner,importedTrack)).total).toBe(1);
  const [progress]=await db.select().from(s.musicProgress).where(eq(s.musicProgress.trackId,importedTrack));
  expect(progress.playCount).toBe(1);
});

run('reading history deletion is exact, private, idempotent and keeps progress and edition bookmarks',async()=>{
  const db=getDb(),raw=getSql();
  const session=await prepareReading(owner,book,{source:'local',format:'pdf',edition:'a'.repeat(64)});
  const location={format:'pdf' as const,page:7,total:10};
  await moveReading(owner,session.id,location);
  const completed=await updateReading(owner,book,{state:'completed'});
  const history=await readingHistoryData(owner,book),entry=history.items.find(item=>item.state==='completed')!;
  expect(await removeReadingHistory(other,book,entry.id)).toEqual({removed:false});
  expect((await readingHistoryData(owner,book)).items).toHaveLength(history.items.length);
  expect(await removeReadingHistory(owner,book,entry.id)).toEqual({removed:true});
  expect(await removeReadingHistory(owner,book,entry.id)).toEqual({removed:false});
  expect((await readingHistoryData(owner,book)).items).toHaveLength(history.items.length-1);
  expect((await db.select().from(s.readingProgress).where(eq(s.readingProgress.userId,owner)))[0]).toEqual(completed);
  expect((await prepareReading(owner,book,{source:'local',format:'pdf',edition:'a'.repeat(64)})).location).toEqual(location);
  expect(await raw`select id from social_activity where user_id=${owner} and source_key=${'reading:'+entry.id}`).toHaveLength(0);
  await db.update(s.users).set({settings:{features:{book:false}}}).where(eq(s.users.id,owner));
  await expect(removeReadingHistory(owner,book,history.items[0].id)).rejects.toMatchObject({status:403});
  await db.update(s.users).set({settings:{}}).where(eq(s.users.id,owner));
});

run('game session deletion keeps the chosen playthrough status and progress, updates time and removes its feed entry',async()=>{
  const raw=getSql(),first=await createPlaythrough(owner,gameId,{status:'in-progress'}),second=await createPlaythrough(owner,gameId,{status:'in-progress',repeat:true});
  const session=await logGameSession(owner,first.id,{id:crypto.randomUUID(),minutesPlayed:30,playedAt:'2020-01-01T12:00:00.000Z'});
  await updatePlaythrough(owner,first.id,{status:'completed',progressPercent:100,completedAt:'2020-01-02T12:00:00.000Z'});
  const before=await playthroughDetails(owner,first.id);
  await expect(removeGameSession(other,first.id,session.id)).rejects.toMatchObject({status:404});
  expect(await removeGameSession(owner,second.id,session.id)).toEqual({removed:false});
  expect(await removeGameSession(owner,first.id,session.id)).toEqual({removed:true});
  expect(await removeGameSession(owner,first.id,session.id)).toEqual({removed:false});
  const after=await playthroughDetails(owner,first.id);
  expect(after).toMatchObject({status:before.status,progressPercent:before.progressPercent,startedAt:before.startedAt,completedAt:before.completedAt,minutesPlayed:0,total:0});
  expect(after.sessions).toEqual([]);
  expect(await raw`select id from social_activity where user_id=${owner} and source_key=${'game_sessions:'+session.id}`).toHaveLength(0);
});

run('resetting one music position is private, idempotent and preserves listens and saved choices',async()=>{
 const db=getDb();
 await db.update(s.musicProgress).set({positionSeconds:42,durationSeconds:120}).where(eq(s.musicProgress.trackId,track));
 await db.insert(s.trackingState).values({userId:owner,mediaId:track,favourite:true,collected:true,watchlist:true});
 const [before]=await db.select().from(s.musicProgress).where(eq(s.musicProgress.trackId,track));
 const listens=await db.select().from(s.musicListens).where(eq(s.musicListens.trackId,track)).orderBy(s.musicListens.id);
 const choices=await db.select().from(s.trackingState).where(eq(s.trackingState.mediaId,track));
 expect(await resetMusicPosition(other,track)).toEqual({reset:false});
 expect((await db.select().from(s.musicProgress).where(eq(s.musicProgress.trackId,track)))[0].positionSeconds).toBe(42);
 expect(await resetMusicPosition(owner,track)).toEqual({reset:true});
 expect(await resetMusicPosition(owner,track)).toEqual({reset:false});
 expect((await db.select().from(s.musicProgress).where(eq(s.musicProgress.trackId,track)))[0]).toMatchObject({positionSeconds:0,playCount:before.playCount,durationSeconds:120});
 expect(await db.select().from(s.musicListens).where(eq(s.musicListens.trackId,track)).orderBy(s.musicListens.id)).toEqual(listens);
 expect(await db.select().from(s.trackingState).where(eq(s.trackingState.mediaId,track))).toEqual(choices);
 await expect(resetMusicPosition(owner,artist)).rejects.toMatchObject({status:400});
 await db.update(s.users).set({settings:{features:{music:false}}}).where(eq(s.users.id,owner));
 await expect(resetMusicPosition(owner,track)).rejects.toMatchObject({status:403});
 await db.update(s.users).set({settings:{}}).where(eq(s.users.id,owner));
});
