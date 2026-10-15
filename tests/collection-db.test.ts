import { collectionPreferences } from '../src/lib/collection/preferences';
import { afterAll,beforeAll,expect,test } from 'bun:test';
import { eq,sql,inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import { users,media,providerInstances,providerConnections,providerItems,availability,syncCheckpoints,trackingState,episodes,shows,works,musicWorks,mediaRelationships,musicListens } from '../src/lib/server/db/schema';
import { collectionData,workAssessments,collectionCTE,collectionRead,workCards } from '../src/lib/collection/query.server';
import { logMusic } from '../src/lib/music/persistence.server';
import { trackWithExports } from '../src/lib/sync/changes.server';
import { getConfig } from '../src/lib/server/config';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let owner:string,viewer:string,server:string,connection:string,movie:string,serverOnly:string,show:string,child:string,sibling:string,album:string,track:string;
const tag=crypto.randomUUID();
const extraMedia:string[]=[];
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;const db=getDb();
 const actors=await db.insert(users).values([{username:`collection-owner-${tag}`},{username:`collection-viewer-${tag}`}]).returning();[owner,viewer]=actors.map(u=>u.id);
 const [instance]=await db.insert(providerInstances).values({provider:'jellyfin',name:`collection-${tag}`,baseUrl:'https://fixture.invalid'}).returning();server=instance.id;
 const [account]=await db.insert(providerConnections).values({userId:owner,instanceId:server,externalUserId:tag}).returning();connection=account.id;
 const titles=await db.insert(media).values([{kind:'movie',title:`personal-${tag}`,releaseDate:'2020-01-01'},{kind:'movie',title:`server-only-${tag}`},{kind:'show',title:`show-${tag}`},{kind:'episode',title:`child-${tag}`,releaseDate:'2020-01-01'},{kind:'episode',title:`sibling-${tag}`,releaseDate:'2020-01-01'}]).returning();[movie,serverOnly,show,child,sibling]=titles.map(m=>m.id);
 await db.insert(shows).values({mediaId:show});await db.insert(episodes).values([{mediaId:child,showId:show,seasonNumber:1,episodeNumber:1},{mediaId:sibling,showId:show,seasonNumber:1,episodeNumber:2}]);
 await db.insert(trackingState).values([{userId:owner,mediaId:movie,collected:true},{userId:owner,mediaId:serverOnly},{userId:owner,mediaId:child,favourite:true}]);
 const [item]=await db.insert(providerItems).values({instanceId:server,mediaId:serverOnly,externalId:tag,kind:'movie'}).returning();await db.insert(availability).values({userId:owner,connectionId:connection,providerItemId:item.id,mediaId:serverOnly});
 await db.insert(syncCheckpoints).values({connectionId:connection,kind:'jellyfin-user',completedAt:new Date()});
 const music=await db.insert(works).values([{category:'music',kind:'album'},{category:'music',kind:'track'}]).returning();[album,track]=music.map(m=>m.id);await db.insert(musicWorks).values([{id:album,kind:'album',title:`album-${tag}`,membershipComplete:true},{id:track,kind:'track',title:`track-${tag}`}]);await db.insert(mediaRelationships).values({parentId:album,childId:track,kind:'contains'});
});
afterAll(async()=>{if(!owner)return;const db=getDb();await db.delete(providerInstances).where(eq(providerInstances.id,server));await db.delete(users).where(sql`${users.id} in (${owner},${viewer})`);await db.delete(media).where(sql`${media.id} in (${movie},${serverOnly},${show},${child},${sibling})`);if(extraMedia.length)await db.delete(media).where(inArray(media.id,extraMedia));await db.delete(works).where(sql`${works.id} in (${album},${track})`);});
run('server presence and empty tracking rows never create Collection membership',async()=>{const data=await collectionData(owner);expect(data.assessments.some(a=>a.id===serverOnly)).toBe(false);expect(data.assessments.some(a=>a.id===movie)).toBe(true);});
run('a child promotes its parent for presentation without selecting siblings',async()=>{const rows=await workAssessments(owner,owner,[show,child,sibling]);expect(rows.find(r=>r.id===show)?.reasons.some(r=>r.origin==='member-derived')).toBe(true);expect(rows.find(r=>r.id===sibling)?.reasons).toEqual([]);});
run('removing direct Collected keeps other reasons and activity',async()=>{await trackWithExports(owner,{mediaId:movie,action:'watchlist',value:true});await trackWithExports(owner,{mediaId:movie,action:'collect',value:false});const [row]=await workAssessments(owner,owner,[movie]);expect(row.reasons.some(r=>r.relationship==='collected')).toBe(false);expect(row.reasons.some(r=>r.relationship==='watchlist')).toBe(true);});
run('viewer availability uses the viewer account independently from owner relationships',async()=>{const [self]=await workAssessments(owner,owner,[serverOnly]);const [visitor]=await workAssessments(owner,viewer,[serverOnly]);expect(self.availability).toBe('available');expect(visitor.availability).toBe('unknown');});
run('fresh full user coverage establishes missing; stale coverage returns unknown',async()=>{const [fresh]=await workAssessments(owner,owner,[movie]);expect(fresh.availability).toBe('unavailable');await getDb().update(syncCheckpoints).set({completedAt:new Date(Date.now()-3600000)}).where(eq(syncCheckpoints.connectionId,connection));const [stale]=await workAssessments(owner,owner,[movie]);expect(stale.availability).toBe('unknown');});
run('album logs atomically record known tracks and retries do not duplicate listens',async()=>{const batchId=crypto.randomUUID();expect((await logMusic(owner,album,{batchId})).added).toBe(1);expect((await logMusic(owner,album,{batchId})).added).toBe(0);const rows=await getDb().select().from(musicListens).where(eq(musicListens.userId,owner));expect(rows.length).toBe(1);const assessments=await workAssessments(owner,owner,[album,track]);expect(assessments.every(a=>a.reasons.length>0)).toBe(true);});
run('root rows exclude children before counts and pagination, while child activity retains its show',async()=>{
 const db=getDb();
 const titles=await db.insert(media).values(Array.from({length:65},(_,i)=>({kind:'movie' as const,title:`root-${i}-${tag}`}))).returning();
 const children=await db.insert(media).values(Array.from({length:65},(_,i)=>({kind:'episode' as const,title:`episode-${i}-${tag}`}))).returning();
 extraMedia.push(...titles.map(m=>m.id),...children.map(m=>m.id));
 await db.insert(episodes).values(children.map((m,i)=>({mediaId:m.id,showId:show,seasonNumber:1,episodeNumber:i+3})));
 await db.insert(trackingState).values([...titles,...children].map(m=>({userId:owner,mediaId:m.id,favourite:true})));
 const first=await collectionData(owner,{category:'screen',level:'root'});
 expect(first.total).toBe(67);expect(first.pages).toBe(2);expect(first.items).toHaveLength(60);
 expect(first.assessments.every(a=>a.kind==='movie'||a.kind==='show')).toBe(true);
 const last=await collectionData(owner,{category:'screen',level:'root',page:200});
 expect(last.page).toBe(2);expect(last.items).toHaveLength(7);
 expect([...first.assessments,...last.assessments].some(a=>a.id===show)).toBe(true);
});
run('a retained positive survives an outage with freshness, while incomplete group membership stays partial',async()=>{
 const db=getDb();await db.update(providerConnections).set({status:'error'}).where(eq(providerConnections.id,connection));
 const [positive]=await workAssessments(owner,owner,[serverOnly]);expect(positive.availability).toBe('available');expect(positive.stale).toBe(true);
 await db.update(providerConnections).set({status:'connected'}).where(eq(providerConnections.id,connection));await db.update(syncCheckpoints).set({completedAt:new Date(),scanId:null}).where(eq(syncCheckpoints.connectionId,connection));
 const [item]=await db.insert(providerItems).values({instanceId:server,mediaId:child,externalId:`child-${tag}`,kind:'episode'}).returning();await db.insert(availability).values({userId:owner,connectionId:connection,providerItemId:item.id,mediaId:child});
 const [partial]=await workAssessments(owner,owner,[show]);expect(partial.availability).toBe('partial');
 await db.insert(providerItems).values({instanceId:server,mediaId:show,externalId:`show-${tag}`,kind:'show',snapshot:{membershipComplete:true}});
 const [stillPartial]=await workAssessments(owner,owner,[show]);expect(stillPartial.availability).toBe('partial');
});
run('retrying an album batch after discovering a new track does not change the logged traversal',async()=>{
 const batchId=crypto.randomUUID();await logMusic(owner,album,{batchId});const db=getDb();
 const [work]=await db.insert(works).values({category:'music',kind:'track'}).returning();
 try{await db.insert(musicWorks).values({id:work.id,kind:'track',title:'Late track'});await db.insert(mediaRelationships).values({parentId:album,childId:work.id,kind:'contains'});
  expect((await logMusic(owner,album,{batchId})).added).toBe(0);expect(await db.select().from(musicListens).where(eq(musicListens.trackId,work.id))).toHaveLength(0);
  await expect(logMusic(owner,track,{batchId})).rejects.toThrow('another work');
 }finally{await db.delete(works).where(eq(works.id,work.id));}
});
run('Continue selects the latest track progress; completed listens remain in album order',async()=>{
 const {musicQueue}=await import('../src/lib/music/queue.server');const {musicProgress}=await import('../src/lib/server/db/schema');
 await getDb().insert(musicProgress).values({userId:owner,trackId:track,positionSeconds:12,playCount:3}).onConflictDoUpdate({target:[musicProgress.userId,musicProgress.trackId],set:{positionSeconds:12,updatedAt:new Date()}});
 const queue=await musicQueue(owner,album);expect(queue.continueId).toBe(track);expect(queue.items.map(i=>i.id)).toEqual([track]);
 const [assessment]=await workAssessments(owner,owner,[track]);expect(assessment.active).toBe(true);expect(assessment.completed).toBe(false);
});
run('saved music queues and ordered playlists retain repeats and listened tracks; screen playlists use their existing sequence',async()=>{
 const {savedMusicQueue}=await import('../src/lib/music/queue.server');const {lists,listItems,upNext}=await import('../src/lib/server/db/schema');const db=getDb();
 const [list]=await db.insert(lists).values({userId:owner,name:'Music sequence',playlist:true}).returning();
 try{await db.insert(listItems).values([{listId:list.id,mediaId:track,position:0},{listId:list.id,mediaId:album,position:1}]);
  expect((await savedMusicQueue(owner,list.id))?.items.map(i=>i.id)).toEqual([track,track]);
  await db.insert(upNext).values({userId:owner,mediaId:album}).onConflictDoNothing();expect((await savedMusicQueue(owner))?.items.map(i=>i.id)).toEqual([track]);
  await db.insert(listItems).values({listId:list.id,mediaId:movie,position:2});expect(await savedMusicQueue(owner,list.id)).toBeNull();
  await expect(savedMusicQueue(viewer,list.id)).rejects.toThrow('not found');
 }finally{await db.delete(lists).where(eq(lists.id,list.id));await db.delete(upNext).where(sql`${upNext.userId}=${owner} and ${upNext.mediaId}=${album}`);}
});
run('administrator demand respects opt-out without removing profile relationships',async()=>{
 const {missingDemand,adminDemand}=await import('../src/lib/collection/demand.server');const db=getDb();
 await db.update(users).set({settings:{shareDemand:false,social:{audience:'public'}}}).where(eq(users.id,owner));
 const personal=await missingDemand(owner,new URL('http://fixture/missing'));expect(personal.items.some(i=>i.workId===movie)).toBe(true);
 const shared=await adminDemand(new URL('http://fixture/admin/demand'));expect(shared.users.some(u=>u.userId===owner)).toBe(false);
 const [visible]=await workAssessments(owner,viewer,[movie]);expect(visible.reasons.some(r=>r.relationship==='watchlist')).toBe(true);
});
run('a partly listened album needs its next unlistened track while finished tracks stay completed',async()=>{
 const db=getDb();const {musicProgress}=await import('../src/lib/server/db/schema');const {missingDemand}=await import('../src/lib/collection/demand.server');
 const {systemSettings}=await import('../src/lib/server/db/schema');const config=await getConfig();
 await db.insert(systemSettings).values({key:'coast',value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}});
 const rows=await db.insert(works).values([{category:'music',kind:'album'},{category:'music',kind:'track'},{category:'music',kind:'track'}]).returning();const [parent,first,next]=rows.map(w=>w.id);
 try{
  await db.insert(musicWorks).values([{id:parent,kind:'album',title:'Partly listened album',membershipComplete:true},{id:first,kind:'track',title:'Finished track'},{id:next,kind:'track',title:'Next track'}]);
  await db.insert(mediaRelationships).values([{parentId:parent,childId:first,kind:'contains',position:0},{parentId:parent,childId:next,kind:'contains',position:1}]);
  await logMusic(owner,first,{batchId:crypto.randomUUID()});await db.update(musicProgress).set({positionSeconds:0}).where(sql`${musicProgress.userId}=${owner} and ${musicProgress.trackId}=${first}`);
  const assessments=await workAssessments(owner,owner,[parent,first]);const current=assessments.find(a=>a.id===parent)!;
  expect(current.active).toBe(true);expect(current.completed).toBe(false);expect(current.nextId).toBe(next);expect(assessments.find(a=>a.id===first)?.completed).toBe(true);
  const demand=await missingDemand(owner,new URL('http://fixture/missing'));expect(demand.items.find(i=>i.workId===parent)?.neededWorkId).toBe(next);
 }finally{await db.delete(works).where(inArray(works.id,rows.map(w=>w.id)));await db.update(systemSettings).set({value:config}).where(eq(systemSettings.key,'coast'));}
});
run('a game replay uses its current playthrough status while retaining earlier completion history',async()=>{
 const db=getDb();const {games,gamePlaythroughs}=await import('../src/lib/server/db/schema');const [game]=await db.insert(games).values({title:'Replay game'}).returning();
 try{
  await db.insert(gamePlaythroughs).values({userId:owner,gameId:game.id,status:'completed',completedAt:new Date(),createdAt:new Date(Date.now()-60000)});
  const [replay]=await db.insert(gamePlaythroughs).values({userId:owner,gameId:game.id,status:'in-progress',createdAt:new Date()}).returning();
  let [state]=await workAssessments(owner,owner,[game.id]);expect(state.active).toBe(true);expect(state.completed).toBe(false);expect(state.dropped).toBe(false);expect(state.reasons.some(r=>r.relationship==='activity')).toBe(true);
  await db.update(gamePlaythroughs).set({status:'planned'}).where(eq(gamePlaythroughs.id,replay.id));[state]=await workAssessments(owner,owner,[game.id]);expect(state.active).toBe(false);expect(state.completed).toBe(false);
  expect(await db.select().from(gamePlaythroughs).where(sql`${gamePlaythroughs.gameId}=${game.id} and ${gamePlaythroughs.status}='completed'`)).toHaveLength(1);
 }finally{await db.delete(games).where(eq(games.id,game.id));}
});
run('album playback and logging include contained tracks, not other related tracks', async () => {
  const db = getDb();
  const { musicQueue } = await import('../src/lib/music/queue.server');
  const [related] = await db.insert(works).values({ category: 'music', kind: 'track' }).returning();
  try {
    await db.insert(musicWorks).values({ id: related.id, kind: 'track', title: 'Related recording' });
    await db.insert(mediaRelationships).values({ parentId: album, childId: related.id, kind: 'sequence' });
    expect((await musicQueue(owner, album)).items.map(item => item.id)).toEqual([track]);
    expect((await logMusic(owner, album, { batchId: crypto.randomUUID() })).added).toBe(1);
    expect(await db.select().from(musicListens).where(eq(musicListens.trackId, related.id))).toHaveLength(0);
  } finally {
    await db.delete(works).where(eq(works.id, related.id));
  }
});

run('paused filtering respects game progress privacy and category-specific sharing', async () => {
  const db = getDb();
  const { games, gamePlaythroughs, systemSettings } = await import('../src/lib/server/db/schema');
  const config = await getConfig();
  const [saved] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, owner));
  const [game] = await db.insert(games).values({ title: 'Private paused game' }).returning();
  try {
    await db.update(systemSettings).set({ value: { ...config, experimentalMusic:true,experimentalGaming:true,experimentalParties:true } }).where(eq(systemSettings.key, 'coast'));
    await db.insert(trackingState).values({ userId: owner, mediaId: game.id, collected: true });
    await db.insert(gamePlaythroughs).values({ userId: owner, gameId: game.id, status: 'paused' });
    await db.update(users).set({ settings: { social: { audience: 'public', categories: { screen: 'private', game: 'public' }, sections: { progress: 'private', activity: 'private' } } } }).where(eq(users.id, owner));
    const [u] = await db.select().from(users).where(eq(users.id, owner));
    const all = await collectionData(viewer, { category: 'game' }, u.username);
    expect(all.items.map(i => i.id)).toContain(game.id);
    expect((await collectionData(viewer, { category: 'game', activity: 'paused' }, u.username)).total).toBe(0);
    expect((await collectionData(owner, { category: 'game', activity: 'paused' })).items.map(i => i.id)).toContain(game.id);
    await db.update(users).set({ settings: { social: { audience: 'public', categories: { screen: 'private', game: 'public' } } } }).where(eq(users.id, owner));
    expect((await collectionData(viewer, { category: 'game', activity: 'paused' }, u.username)).items.map(i => i.id)).toContain(game.id);
  } finally {
    await db.delete(games).where(eq(games.id, game.id));
    await db.update(users).set({ settings: saved.settings }).where(eq(users.id, owner));
    await db.update(systemSettings).set({ value: config }).where(eq(systemSettings.key, 'coast'));
  }
});

run('administrator demand filters empty users before pagination and totals',async()=>{
 const {adminDemand}=await import('../src/lib/collection/demand.server');const db=getDb();
 const population=await db.insert(users).values(Array.from({length:65},(_,i)=>({username:`aaa-empty-${i}-${tag}`}))).returning();
 const [needed]=await db.insert(users).values({username:`zzz-demand-${tag}`}).returning();
 try{
  await db.insert(trackingState).values({userId:needed.id,mediaId:movie,watchlist:true});
  const first=await adminDemand(new URL('http://fixture/admin/demand'));
  expect(first.users.map(u=>u.userId)).toContain(needed.id);expect(first.pages).toBe(1);
  expect(first.users.every(u=>u.total>0)).toBe(true);
  const clamped=await adminDemand(new URL('http://fixture/admin/demand?page=99'));
  expect(clamped.page).toBe(1);expect(clamped.users.map(u=>u.userId)).toContain(needed.id);
 }finally{await db.delete(users).where(inArray(users.id,[...population.map(u=>u.id),needed.id]));}
});

run('scoped Collection reads retain the same reasons and assessments as a full inventory read',async()=>{
 for(const category of ['all','screen','music','game']){
  const read=async(scope:'all'|'personal')=>Array.from(await collectionRead(sql`${collectionCTE(owner,owner,'all',scope,category)} select * from collection where (${category}='all' or category=${category}) order by id`));
  expect(await read('personal')).toEqual(await read('all'));
 }
});

run('automatic Collection rules are owner-specific and keep explicit collection and history intact',async()=>{
 const db=getDb();const [item]=await db.insert(media).values({kind:'movie',title:`preferences-${tag}`}).returning();extraMedia.push(item.id);
 await db.insert(trackingState).values({userId:owner,mediaId:item.id,watched:true,playCount:1,watchlist:true});
 const preferences=collectionPreferences();preferences.screen.history=false;preferences.screen.watchlist=false;
 try{
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  expect((await workAssessments(owner,owner,[item.id]))[0].reasons).toHaveLength(0);
  preferences.screen.watchlist=true;
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  expect((await workAssessments(owner,owner,[item.id]))[0].reasons.some(r=>r.relationship==='watchlist')).toBe(true);
  await db.update(trackingState).set({dropped:true}).where(sql`${trackingState.userId}=${owner} and ${trackingState.mediaId}=${item.id}`);
  expect((await workAssessments(owner,owner,[item.id]))[0].reasons).toHaveLength(0);
  preferences.screen.dropped=true;
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  expect((await workAssessments(owner,owner,[item.id]))[0].reasons.length).toBeGreaterThan(0);
  preferences.screen.dropped=false;preferences.screen.watchlist=false;
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  await db.update(trackingState).set({collected:true}).where(sql`${trackingState.userId}=${owner} and ${trackingState.mediaId}=${item.id}`);
  expect((await workAssessments(owner,owner,[item.id]))[0].reasons.some(r=>r.relationship==='collected')).toBe(true);
  const [state]=await db.select().from(trackingState).where(sql`${trackingState.userId}=${owner} and ${trackingState.mediaId}=${item.id}`);
  expect(state.watched).toBe(true);expect(state.watchlist).toBe(true);expect(state.playCount).toBe(1);
 }finally{await db.update(users).set({settings:{}}).where(eq(users.id,owner));}
});
run('Listen history can be excluded independently of Watch and explicit collection',async()=>{
 const db=getDb();const screenBefore=(await workAssessments(owner,owner,[movie]))[0].reasons;const preferences=collectionPreferences();preferences.music.history=false;preferences.music.active=false;
 await db.insert(musicListens).values({userId:owner,trackId:track,batchId:crypto.randomUUID(),occurredAt:new Date(),source:'coast'});
 try{
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  expect((await workAssessments(owner,owner,[track]))[0].reasons.filter(r=>r.relationship==='activity')).toHaveLength(0);
  expect((await workAssessments(owner,owner,[movie]))[0].reasons).toEqual(screenBefore);
 }finally{await db.update(users).set({settings:{}}).where(eq(users.id,owner));}
});

run('in-progress shows remain included when completed history is excluded',async()=>{
 const db=getDb();const preferences=collectionPreferences();preferences.screen.history=false;preferences.screen.favourite=false;
 await db.update(trackingState).set({watched:true}).where(sql`${trackingState.userId}=${owner} and ${trackingState.mediaId}=${child}`);
 try{
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  expect((await workAssessments(owner,owner,[show]))[0].reasons.some(r=>r.relationship==='activity')).toBe(true);
  preferences.screen.active=false;
  await db.update(users).set({settings:{collection:preferences}}).where(eq(users.id,owner));
  expect((await workAssessments(owner,owner,[show]))[0].reasons.some(r=>r.relationship==='activity')).toBe(false);
 }finally{await db.update(users).set({settings:{}}).where(eq(users.id,owner));}
});

run('reading metadata, private page states and shared lists retain their own semantics',async()=>{
 const db=getDb();const {systemSettings}=await import('../src/lib/server/db/schema');
 const {importReading}=await import('../src/lib/catalogue/reading.server');
 const {ensureReadingSaved,updateReading}=await import('../src/lib/core/reading/service.server');
 const {createList,addListItem,getList}=await import('../src/lib/core/lists/service.server');
 const {listsData}=await import('../src/lib/server/queries/lists');
 const config=await getConfig();
 const [reader]=await db.insert(users).values({username:`reading-collection-${tag}`}).returning();
 const ids:string[]=[];
 await db.insert(systemSettings).values({key:'coast',value:{...config,experimentalBooks:true,experimentalComics:true}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...config,experimentalBooks:true,experimentalComics:true}}});
 try{
  const states=['planned','reading','paused','completed','dropped'] as const;
  for(let index=0;index<states.length;index++){
   const item=await importReading({provider:'openlibrary',externalId:`OL${920000001+index}W`,kind:'book',title:`Reading ${states[index]} ${tag}`,sourceUrl:`https://openlibrary.org/works/OL${920000001+index}W`,authors:['Reading Author'],subjects:[],publishedYear:1942,coverUrl:'https://covers.openlibrary.org/b/id/1-L.jpg'});
   ids.push(item.id);await updateReading(reader.id,item.id,{state:states[index],...(states[index]==='reading'?{page:5,totalPages:100}:{})});
  }
  const comic=await importReading({provider:'comic-vine',externalId:'4000-920000001',kind:'comic',title:'Reading comic fixture',sourceUrl:'https://comicvine.gamespot.com/issue/4000-920000001/',authors:[],subjects:[],seriesTitle:'Reading Series',issueNumber:'2'});ids.push(comic.id);
  expect((await collectionData(reader.id,{category:'book'})).total).toBe(4);
  expect((await collectionData(reader.id,{category:'comic'})).total).toBe(0);
  const assessment=(await workAssessments(reader.id,reader.id,[ids[1]]))[0];
  expect(assessment.title).toBe(`Reading reading ${tag}`);expect(assessment.releaseDate).toBeNull();expect(assessment.active).toBe(true);expect(assessment.availability).toBe('unknown');
  expect((await collectionData(reader.id,{category:'book',activity:'planned'})).items.map(item=>item.id)).toEqual([ids[0]]);
  expect((await collectionData(reader.id,{category:'book',activity:'active'})).items.map(item=>item.id).sort()).toEqual([ids[1],ids[2]].sort());
  expect((await collectionData(reader.id,{category:'book',activity:'paused'})).items.map(item=>item.id)).toEqual([ids[2]]);
  expect((await collectionData(reader.id,{category:'book',activity:'completed'})).items.map(item=>item.id)).toEqual([ids[3]]);
  expect(await ensureReadingSaved(reader.id,ids[1])).toMatchObject({state:'reading',page:5,totalPages:100});
  await db.insert(trackingState).values([...ids.slice(0,5).map(mediaId=>({userId:reader.id,mediaId,watchlist:true})),{userId:reader.id,mediaId:comic.id,favourite:true}]);
  expect((await listsData(reader.id,{category:'book',view:'watchlist',filter:'to-watch'})).items.map(item=>item.id)).toEqual([ids[0]]);
  expect((await listsData(reader.id,{category:'book',view:'watchlist',filter:'progress'})).items.map(item=>item.id).sort()).toEqual([ids[1],ids[2]].sort());
  expect((await listsData(reader.id,{category:'book',view:'watchlist',filter:'complete'})).items.map(item=>item.id)).toEqual([ids[3]]);
  expect((await listsData(reader.id,{category:'book',view:'watchlist',filter:'dropped'})).items.map(item=>item.id)).toEqual([ids[4]]);
  const list=await createList(reader.id,{name:'Reading list'});await addListItem(reader.id,list.id,ids[1]);await addListItem(reader.id,list.id,comic.id);
  expect((await getList(reader.id,list.id)).items.map(entry=>entry.item.title)).toEqual([`Reading reading ${tag}`,comic.title]);
  const listCards=(await listsData(reader.id,{view:list.id})).items;
  expect(listCards.map(item=>item.id)).toEqual([ids[1],comic.id]);
  expect(listCards[0]).toMatchObject({kind:'book',title:`Reading reading ${tag}`,year:1942,poster:'https://covers.openlibrary.org/b/id/1-L.jpg',href:`/media/${ids[1]}`});
  expect(listCards[1]).toMatchObject({kind:'comic',href:`/media/${comic.id}`,attribution:{label:'Comic Vine',href:comic.sourceUrl}});
  expect((await listsData(reader.id,{category:'comic',view:'favourites'})).items.map(item=>item.id)).toEqual([comic.id]);
  await db.update(trackingState).set({collected:true}).where(sql`${trackingState.userId}=${reader.id} and ${trackingState.mediaId} in (${ids[2]},${ids[4]})`);
  expect((await collectionData(reader.id,{category:'book',activity:'dropped'})).items.map(item=>item.id)).toEqual([ids[4]]);
  await db.update(users).set({settings:{social:{audience:'public',sections:{activity:'private',progress:'private'}}}}).where(eq(users.id,reader.id));
  const visitor=await collectionData(viewer,{category:'book'},reader.username);
  expect(visitor.items.map(item=>item.id)).toContain(ids[2]);expect(visitor.assessments.find(item=>item.id===ids[2])?.active).toBe(false);
  expect((await collectionData(viewer,{category:'book',activity:'paused'},reader.username)).total).toBe(0);
  expect((await collectionData(viewer,{category:'book',activity:'completed'},reader.username)).total).toBe(0);
  expect((await collectionData(reader.id,{category:'book',activity:'paused'})).total).toBe(1);
 }finally{
  await db.delete(users).where(eq(users.id,reader.id));if(ids.length)await db.delete(works).where(inArray(works.id,ids));
  await db.update(systemSettings).set({value:config}).where(eq(systemSettings.key,'coast'));
 }
});

run('planned reading activity keeps saved relationships independent and respects activity privacy',async()=>{
 const db=getDb();const {systemSettings}=await import('../src/lib/server/db/schema');
 const {importReading}=await import('../src/lib/catalogue/reading.server');
 const {ensureReadingSaved}=await import('../src/lib/core/reading/service.server');
 const {readingDetails}=await import('../src/lib/reading/query.server');
 const {listsData}=await import('../src/lib/server/queries/lists');
 const config=await getConfig();
 const [reader]=await db.insert(users).values({username:`planned-reading-${tag}`,settings:{social:{audience:'public'}}}).returning();
 let id:string|undefined;
 await db.insert(systemSettings).values({key:'coast',value:{...config,experimentalBooks:true}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...config,experimentalBooks:true}}});
 try{
  const item=await importReading({provider:'openlibrary',externalId:'OL920000011W',kind:'book',title:`Planned reading ${tag}`,sourceUrl:'https://openlibrary.org/works/OL920000011W',authors:[],subjects:[]});id=item.id;
  expect((await ensureReadingSaved(reader.id,id)).state).toBe('planned');
  let [assessment]=await workAssessments(reader.id,reader.id,[id]);
  expect(assessment.reasons).toEqual([{relationship:'activity',origin:'direct',workId:id}]);
  expect(assessment.active).toBe(false);
  expect((await readingDetails(reader.id,id)).relationships.watchlist).toBe(false);
  expect((await listsData(reader.id,{category:'book',view:'watchlist'})).total).toBe(0);
  expect((await collectionData(reader.id,{category:'book',activity:'planned'})).items.map(item=>item.id)).toEqual([id]);
  await trackWithExports(reader.id,{mediaId:id,action:'watchlist',value:true});
  [assessment]=await workAssessments(reader.id,reader.id,[id]);
  expect(assessment.reasons.some(reason=>reason.relationship==='watchlist'&&reason.origin==='direct')).toBe(true);
  expect((await listsData(reader.id,{category:'book',view:'watchlist'})).items.map(item=>item.id)).toEqual([id]);
  await trackWithExports(reader.id,{mediaId:id,action:'watchlist',value:false});
  [assessment]=await workAssessments(reader.id,reader.id,[id]);
  expect(assessment.reasons).toEqual([{relationship:'activity',origin:'direct',workId:id}]);
  expect((await listsData(reader.id,{category:'book',view:'watchlist'})).total).toBe(0);
  const details=await readingDetails(reader.id,id);
  expect(details.progress?.state).toBe('planned');expect(details.relationships.watchlist).toBe(false);
  expect((await collectionData(reader.id,{category:'book',activity:'planned'})).items.map(item=>item.id)).toEqual([id]);
  expect((await collectionData(viewer,{category:'book'},reader.username)).items.map(item=>item.id)).toEqual([id]);
  await db.update(users).set({settings:{social:{audience:'public',sections:{activity:'private',progress:'private'}}}}).where(eq(users.id,reader.id));
  expect((await collectionData(viewer,{category:'book'},reader.username)).total).toBe(0);
  expect((await workAssessments(reader.id,viewer,[id]))[0].reasons).toEqual([]);
  expect((await collectionData(reader.id,{category:'book',activity:'planned'})).items.map(item=>item.id)).toEqual([id]);
  await trackWithExports(reader.id,{mediaId:id,action:'collect',value:true});
  const shared=await collectionData(viewer,{category:'book'},reader.username);
  expect(shared.items.map(item=>item.id)).toEqual([id]);
  expect(shared.assessments[0].reasons).toEqual([{relationship:'collected',origin:'direct',workId:id}]);
 }finally{
  await db.delete(users).where(eq(users.id,reader.id));if(id)await db.delete(works).where(eq(works.id,id));
  await db.update(systemSettings).set({value:config}).where(eq(systemSettings.key,'coast'));
 }
});

run('reading gates filter Collection and card hydration before counts and pagination',async()=>{
 const db=getDb();const {readingWorks,systemSettings}=await import('../src/lib/server/db/schema');
 const config=await getConfig();const [reader]=await db.insert(users).values({username:`reading-pages-${tag}`}).returning();
 const ids=Array.from({length:65},()=>crypto.randomUUID());
 await db.insert(systemSettings).values({key:'coast',value:{...config,experimentalBooks:true,experimentalComics:false}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...config,experimentalBooks:true,experimentalComics:false}}});
 try{
  await db.insert(works).values(ids.map((id,index)=>({id,category:index<3?'comic':'book',kind:index<3?'comic' as const:'book' as const})));
  await db.insert(readingWorks).values(ids.map((id,index)=>({id,provider:index<3?'comic-vine' as const:'openlibrary' as const,externalId:index<3?`4000-${930000001+index}`:`OL${930000001+index}W`,kind:index<3?'comic' as const:'book' as const,title:index<3?`AAA hidden comic ${index}`:`Book ${String(index).padStart(3,'0')}`,sourceUrl:index<3?`https://comicvine.gamespot.com/issue/4000-${930000001+index}/`:`https://openlibrary.org/works/OL${930000001+index}W`})));
  await db.insert(trackingState).values(ids.map(mediaId=>({userId:reader.id,mediaId,collected:true})));
  const first=await collectionData(reader.id),last=await collectionData(reader.id,{page:100});
  expect(first.total).toBe(62);expect(first.pages).toBe(2);expect(first.items).toHaveLength(60);expect(first.items.every(item=>item.kind==='book')).toBe(true);
  expect(last.page).toBe(2);expect(last.items).toHaveLength(2);expect(last.total).toBe(62);
  expect((await workCards(reader.id,reader.id,ids)).map(item=>item.id).sort()).toEqual(ids.slice(3).sort());
  await expect(collectionData(reader.id,{category:'comic'})).rejects.toThrow('disabled');
  expect((await workCards(reader.id,reader.id,ids.slice(0,3)))).toEqual([]);
 }finally{
  await db.delete(users).where(eq(users.id,reader.id));await db.delete(works).where(inArray(works.id,ids));
  await db.update(systemSettings).set({value:config}).where(eq(systemSettings.key,'coast'));
 }
});
