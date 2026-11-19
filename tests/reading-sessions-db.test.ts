import {beforeAll,afterAll,test,expect,spyOn} from 'bun:test';
import {getDb,getSql} from '../src/lib/server/db';
import {getConfig,type CoastConfig} from '../src/lib/server/config';
import {prepareReading,moveReading,ownedReadingSession,closeReading,matchingReading,linkedReadingSources} from '../src/lib/reading/sessions.server';
import {updateReading} from '../src/lib/core/reading/service.server';
import {createRoom,inviteParticipant,joinRoom,commandRoom,roomState} from '../src/lib/playback/synced/service.server';
import {presence} from '../src/lib/social/presence.server';
import {recommendationRows} from '../src/lib/recommendations/query.server';
async function saveConfig(value:CoastConfig){await getSql()`INSERT INTO system_settings(key,value) VALUES('coast',${value}::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;}
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const users=[crypto.randomUUID(),crypto.randomUUID()],work=crypto.randomUUID(),other=crypto.randomUUID();let config:CoastConfig;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;config=await getConfig();await saveConfig({...config,experimentalBooks:true,experimentalComics:true,experimentalParties:true,experimentalPlanning:true});
 for(const id of users)await getSql()`INSERT INTO users(id,username) VALUES(${id},${`reader-${id}`})`;
 for(const id of [work,other]){await getSql()`INSERT INTO works(id,category,kind) VALUES(${id},'book','book')`;await getSql()`INSERT INTO reading_works(id,provider,external_id,kind,title,authors,subjects,source_url) VALUES(${id},'openlibrary',${id===work?'OL999871W':'OL999872W'},'book','Reader fixture',ARRAY['Fixture author'],ARRAY['Fantasy'],'https://openlibrary.org/works/OL999871W')`;}
 await getSql()`INSERT INTO friendships(user_a,user_b,requested_by,state) VALUES(least(${users[0]}::uuid,${users[1]}::uuid),greatest(${users[0]}::uuid,${users[1]}::uuid),${users[0]},'accepted')`;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await saveConfig(config);for(const id of users)await getSql()`DELETE FROM users WHERE id=${id}`;for(const id of [work,other])await getSql()`DELETE FROM works WHERE id=${id}`;});
const local=(format='pdf',edition='a'.repeat(64))=>({source:'local',format,edition});
run('reading from beginning preserves the saved bookmark until the new session actually reads',async()=>{
 const other=crypto.randomUUID();
 await getSql()`INSERT INTO works(id,category,kind) VALUES(${other},'book','book')`;
 await getSql()`INSERT INTO reading_works(id,provider,external_id,kind,title,source_url) VALUES(${other},'openlibrary','OL698473W','book','Beginning fixture','https://fixture.invalid')`;
 try{
 const edition='8'.repeat(64);
 const initial=await prepareReading(users[0],other,local('pdf',edition));
 await moveReading(users[0],initial.id,{format:'pdf',page:3,total:8});
 await closeReading(users[0],initial.id);
 const [before]=await getSql()`SELECT state,page,bookmark_cycle FROM reading_progress WHERE user_id=${users[0]} AND work_id=${other}`;
 const fresh=await prepareReading(users[0],other,{...local('pdf',edition),fromBeginning:true});
 expect(fresh.location).toBeNull();
 await closeReading(users[0],fresh.id);
 expect((await prepareReading(users[0],other,local('pdf',edition))).location).toEqual({format:'pdf',page:3,total:8});
 const [after]=await getSql()`SELECT state,page,bookmark_cycle FROM reading_progress WHERE user_id=${users[0]} AND work_id=${other}`;
 expect(after).toEqual(before);
 const started=await prepareReading(users[0],other,{...local('pdf',edition),fromBeginning:true});
 await moveReading(users[0],started.id,{format:'pdf',page:1,total:8});
 await closeReading(users[0],started.id);
 expect((await prepareReading(users[0],other,local('pdf',edition))).location).toEqual({format:'pdf',page:1,total:8});
 }finally{await getSql()`DELETE FROM works WHERE id=${other}`;}
});
run('reading sessions are private, bounded and resume the same edition',async()=>{
 const s=await prepareReading(users[0],work,local());expect(s.url).toBeNull();
 await expect(ownedReadingSession(users[1],s.id)).rejects.toMatchObject({status:410});
 await expect(moveReading(users[0],s.id,{format:'pdf',page:5,total:4})).rejects.toThrow();
 await expect(moveReading(users[0],s.id,{format:'cbz',page:1,total:4})).rejects.toThrow();
 await moveReading(users[0],s.id,{format:'pdf',page:2,total:4});await closeReading(users[0],s.id);
 await expect(moveReading(users[0],s.id,{format:'pdf',page:1,total:4})).rejects.toMatchObject({status:410});
 expect((await prepareReading(users[0],work,local())).location).toEqual({format:'pdf',page:2,total:4});
 expect((await prepareReading(users[0],work,local('pdf','b'.repeat(64)))).location).toBeNull();
 await expect(matchingReading(users[1],work,'a'.repeat(64))).rejects.toMatchObject({status:409});
});
run('archive formats persist bookmarks and party locations without accepting another format',async()=>{
 for(const format of ['cbr','cb7','cbt'] as const){
  const edition=(format==='cbr'?'1':format==='cb7'?'2':'3').repeat(64);
  const host=await prepareReading(users[0],work,local(format,edition));
  await moveReading(users[0],host.id,{format,page:2,total:4});
  await closeReading(users[0],host.id);
  const resumed=await prepareReading(users[0],work,local(format,edition));
  expect(resumed.location).toEqual({format,page:2,total:4});
  const guest=await prepareReading(users[1],work,local(format,edition));
  let room=await createRoom(users[0],{readingSessionId:resumed.id});await inviteParticipant(users[0],room.id,{friendId:users[1]});
  room=await joinRoom(users[1],room.id,{readingSessionId:guest.id,revision:room.revision});
  room=await commandRoom(users[0],room.id,{revision:room.revision,action:'location',location:{format,page:3,total:4}});
  expect(room.readingFormat).toBe(format);expect(room.reading).toEqual({format,page:3,total:4});
  await expect(commandRoom(users[0],room.id,{revision:room.revision,action:'location',location:{format:'cbz',page:3,total:4}})).rejects.toMatchObject({status:409});
  await commandRoom(users[0],room.id,{revision:room.revision,action:'end'});
 }
});
run('state changes journal once, page turns do not create feed spam or invent completion',async()=>{
 const before=(await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total;
 await updateReading(users[0],work,{state:'completed'});await updateReading(users[0],work,{state:'completed'});
 expect((await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before+1);
 await updateReading(users[0],work,{state:'reading',page:0,totalPages:4});
 await updateReading(users[0],work,{page:4});
 expect((await getSql()`SELECT state FROM reading_progress WHERE user_id=${users[0]} AND work_id=${work}`)[0].state).toBe('reading');
 expect((await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before+2);
});
run('reading parties require own matching edition and respect controller rights and revision',async()=>{
 const host=await prepareReading(users[0],work,local()),guest=await prepareReading(users[1],work,local());
 let room=await createRoom(users[0],{readingSessionId:host.id});await inviteParticipant(users[0],room.id,{friendId:users[1]});
 await expect(joinRoom(users[1],room.id,{revision:room.revision})).rejects.toMatchObject({status:409});
 const wrong=await prepareReading(users[1],work,local('cbz'));
 await expect(joinRoom(users[1],room.id,{readingSessionId:wrong.id,revision:room.revision})).rejects.toMatchObject({status:409});
 room=await joinRoom(users[1],room.id,{readingSessionId:guest.id,revision:room.revision});
 await expect(commandRoom(users[1],room.id,{revision:room.revision,action:'location',location:{format:'pdf',page:3,total:4}})).rejects.toMatchObject({status:403});
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'location',location:{format:'pdf',page:3,total:4}});
 expect(room.reading).toEqual({format:'pdf',page:3,total:4});
 await expect(commandRoom(users[0],room.id,{revision:room.revision-1,action:'location',location:{format:'pdf',page:2,total:4}})).rejects.toMatchObject({status:409});
 await expect(commandRoom(users[0],room.id,{revision:room.revision,action:'seek',positionSeconds:3})).rejects.toMatchObject({status:400});
 await expect(commandRoom(users[0],room.id,{revision:room.revision,action:'location',location:{format:'pdf',page:1,total:5}})).rejects.toMatchObject({status:409});
 const next=await prepareReading(users[0],other,local('epub','c'.repeat(64)));
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'item',readingSessionId:next.id});expect(room.reading).toBeNull();expect(room.readingFormat).toBe('epub');expect(room.paused).toBe(true);
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'location',location:{format:'epub',cfi:'epubcfi(/6/2!/4/2/1:0)',fraction:.5}});expect(room.reading?.format).toBe('epub');
 await closeReading(users[0],next.id);expect((await roomState(users[1],room.id)).participants.find(p=>p.userId===users[0])?.joined).toBe(false);
});
run('disabled accounts and experiments cannot open files or read party state',async()=>{
 await getSql()`UPDATE users SET disabled=TRUE WHERE id=${users[1]}`;
 try{await expect(prepareReading(users[1],work,local())).rejects.toMatchObject({status:401});}finally{await getSql()`UPDATE users SET disabled=FALSE WHERE id=${users[1]}`;}
 const host=await prepareReading(users[0],work,local());const room=await createRoom(users[0],{readingSessionId:host.id});
 await saveConfig({...config,experimentalBooks:false,experimentalComics:true,experimentalParties:true});
 try{await expect(ownedReadingSession(users[0],host.id)).rejects.toMatchObject({status:404});await expect(roomState(users[0],room.id)).rejects.toMatchObject({status:404});}finally{await saveConfig({...config,experimentalBooks:true,experimentalComics:true,experimentalParties:true,experimentalPlanning:true});}
});
run('an invited member can join after a reading party becomes idle',async()=>{
 const host=await prepareReading(users[0],work,local());
 let room=await createRoom(users[0],{readingSessionId:host.id});await inviteParticipant(users[0],room.id,{friendId:users[1]});
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'stop'});
 expect(room.mediaId).toBeNull();
 room=await joinRoom(users[1],room.id,{revision:room.revision});
 expect(room.participants.find(member=>member.userId===users[1])?.joined).toBe(true);
});
run('reading recommendations reuse cached catalogue and private interest signals',async()=>{
 await updateReading(users[0],work,{state:'reading',page:2,totalPages:4});
 const result=await recommendationRows(users[0],'recommendations',new URL('http://coast?category=reading'));
 expect(result.items.map(item=>item.id)).toContain(other);expect(result.items.map(item=>item.id)).not.toContain(work);
 const live=await presence(users[0]);expect(Array.isArray(live)).toBe(true);
});

run('EPUB reopening preserves explicit completion; rereads reset all edition bookmarks',async()=>{
 const session=await prepareReading(users[0],work,local('epub','d'.repeat(64)));
 await updateReading(users[0],work,{state:'completed'});
 const before=(await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total;
 await moveReading(users[0],session.id,{format:'epub',cfi:'epubcfi(/6/2!/4/2/1:0)',fraction:.25});
 expect((await getSql()`SELECT state FROM reading_progress WHERE user_id=${users[0]} AND work_id=${work}`)[0].state).toBe('completed');
 expect((await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before);
 await updateReading(users[0],work,{restart:true,state:'reading',page:0});
 await expect(ownedReadingSession(users[0],session.id)).rejects.toMatchObject({status:410});
 expect((await prepareReading(users[0],work,local('epub','d'.repeat(64)))).location).toBeNull();
 await expect(updateReading(users[0],work,{restart:true,state:'reading',page:0})).rejects.toMatchObject({status:409});
});

run('ending a reread restores the completed read and each edition without duplicating history', async () => {
 const edition = 'e'.repeat(64), otherEdition = 'f'.repeat(64);
 const original = await prepareReading(users[0],work,local('epub',edition));
 const location = {format:'epub' as const,cfi:'epubcfi(/6/2!/4/2/1:0)',fraction:.75};
 await moveReading(users[0],original.id,location);
 const otherSession = await prepareReading(users[0],work,local('pdf',otherEdition));
 await moveReading(users[0],otherSession.id,{format:'pdf',page:3,total:4});
 const occurredAt='2020-02-01T12:00:00.000Z';
 const completed=await updateReading(users[0],work,{state:'completed',occurredAt});
 expect(completed.completedAt?.toISOString()).toBe(occurredAt);
 const before=(await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total;
 const reread=await updateReading(users[0],work,{restart:true,state:'reading',page:0,occurredAt:'2020-03-01T12:00:00.000Z'});
 expect(reread.rereadRestore?.bookmarkCycle).toBe(completed.bookmarkCycle);
 await expect(ownedReadingSession(users[0],original.id)).rejects.toMatchObject({status:410});
 const fresh=await prepareReading(users[0],work,local('epub',edition));
 expect(fresh.location).toBeNull();
 await moveReading(users[0],fresh.id,{...location,fraction:.2});
 const {pruneTransientRecords}=await import('../src/lib/server/storage/retention.server');
 await getSql()`UPDATE reading_sessions SET expires_at=now()-interval '31 days' WHERE id IN (${original.id}::uuid,${otherSession.id}::uuid)`;
 await pruneTransientRecords();
 expect((await getSql()`SELECT count(*)::int AS total FROM reading_sessions WHERE id IN (${original.id}::uuid,${otherSession.id}::uuid)`)[0].total).toBe(2);
 const restored=await updateReading(users[0],work,{endReread:reread.bookmarkCycle});
 expect(restored).toMatchObject({state:'completed',page:completed.page,totalPages:completed.totalPages,bookmarkCycle:completed.bookmarkCycle,rereadRestore:null});
 expect(restored.completedAt).toEqual(completed.completedAt);
 expect((await prepareReading(users[0],work,local('epub',edition))).location).toEqual(location);
 expect((await prepareReading(users[0],work,local('pdf',otherEdition))).location).toEqual({format:'pdf',page:3,total:4});
 await expect(ownedReadingSession(users[0],fresh.id)).rejects.toMatchObject({status:410});
 expect((await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before+1);
 expect(await updateReading(users[0],work,{endReread:reread.bookmarkCycle})).toEqual(restored);
 await getSql()`UPDATE reading_sessions SET expires_at=now()-interval '31 days' WHERE id=${fresh.id}`;
 await pruneTransientRecords();
 expect(await getSql()`SELECT id FROM reading_sessions WHERE id=${fresh.id}`).toHaveLength(0);
 const newer=await updateReading(users[0],work,{restart:true,state:'reading',page:0});
 await expect(updateReading(users[0],work,{endReread:reread.bookmarkCycle})).rejects.toMatchObject({status:409});
 await expect(updateReading(users[1],work,{endReread:newer.bookmarkCycle})).rejects.toMatchObject({status:409});
 await updateReading(users[0],work,{endReread:newer.bookmarkCycle});
});

run('correcting a completed reading date updates one owned history and activity entry', async () => {
 await updateReading(users[0],work,{state:'completed',occurredAt:'2020-04-01T12:00:00.000Z'});
 const before=(await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total;
 const occurredAt='2020-05-01T12:00:00.000Z';
 const corrected=await updateReading(users[0],work,{state:'completed',occurredAt});
 expect(await updateReading(users[0],work,{state:'completed',occurredAt})).toEqual(corrected);
 expect((await getSql()`SELECT count(*)::int AS total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before);
 const rows=await getSql()`SELECT h.occurred_at, a.occurred_at AS projected_at FROM reading_history h
  JOIN social_activity a ON a.user_id=h.user_id AND a.source_key='reading:'||h.id
  WHERE h.user_id=${users[0]} AND h.work_id=${work} AND h.state='completed' AND h.occurred_at=${occurredAt}::timestamptz`;
 expect(rows).toHaveLength(1);
 expect(new Date(rows[0].projected_at).toISOString()).toBe(occurredAt);
 await updateReading(users[0],work,{state:'reading',page:0,totalPages:4});
});

run('resetting reading position clears every edition while keeping completion and history',async()=>{
 const db=getSql(),epub='6'.repeat(64),pdf='7'.repeat(64);
 await updateReading(users[0],work,{state:'reading',page:2,totalPages:4});
 const first=await prepareReading(users[0],work,local('epub',epub));
 const second=await prepareReading(users[0],work,local('pdf',pdf));
 await moveReading(users[0],first.id,{format:'epub',cfi:'epubcfi(/6/2!/4/2/1:0)',fraction:.75});
 await moveReading(users[0],second.id,{format:'pdf',page:3,total:4});
 const completed=await updateReading(users[0],work,{state:'completed',occurredAt:'2021-01-01T12:00:00.000Z'});
 const history=await db`SELECT id,state,occurred_at FROM reading_history WHERE user_id=${users[0]} AND work_id=${work} ORDER BY id`;
 const reset=await updateReading(users[0],work,{reset:'position'});
 expect(reset).toMatchObject({state:'completed',page:0,totalPages:4,startedAt:completed.startedAt,completedAt:completed.completedAt,rereadRestore:null});
 expect(reset.bookmarkCycle).not.toBe(completed.bookmarkCycle);
 expect(await db`SELECT id,state,occurred_at FROM reading_history WHERE user_id=${users[0]} AND work_id=${work} ORDER BY id`).toEqual(history);
 expect(await db`SELECT id FROM reading_sessions WHERE id IN (${first.id}::uuid,${second.id}::uuid)`).toHaveLength(2);
 await expect(moveReading(users[0],first.id,{format:'epub',cfi:'epubcfi(/6/2!/4/2/1:0)',fraction:.9})).rejects.toMatchObject({status:410});
 await expect(moveReading(users[0],second.id,{format:'pdf',page:4,total:4})).rejects.toMatchObject({status:410});
 expect((await prepareReading(users[0],work,local('epub',epub))).location).toBeNull();
 expect((await prepareReading(users[0],work,local('pdf',pdf))).location).toBeNull();
});

run('resetting a reread preserves End reread restoration and fences the old cycle',async()=>{
 const db=getSql(),edition='8'.repeat(64),location={format:'pdf' as const,page:3,total:4};
 const original=await prepareReading(users[0],work,local('pdf',edition));
 await moveReading(users[0],original.id,location);
 const completed=await updateReading(users[0],work,{state:'completed'});
 const before=(await db`SELECT count(*)::int total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total;
 const reread=await updateReading(users[0],work,{restart:true,state:'reading',page:0});
 const current=await prepareReading(users[0],work,local('pdf',edition));
 await moveReading(users[0],current.id,{format:'pdf',page:1,total:4});
 const reset=await updateReading(users[0],work,{reset:'position'});
 expect(reset.rereadRestore).toEqual(reread.rereadRestore);
 expect(reset.state).toBe('reading');expect(reset.page).toBe(0);
 await expect(moveReading(users[0],current.id,{format:'pdf',page:2,total:4})).rejects.toMatchObject({status:410});
 await expect(updateReading(users[0],work,{endReread:reread.bookmarkCycle})).rejects.toMatchObject({status:409});
 const restored=await updateReading(users[0],work,{endReread:reset.bookmarkCycle});
 expect(restored).toMatchObject({state:'completed',page:completed.page,bookmarkCycle:completed.bookmarkCycle,rereadRestore:null});
 expect((await prepareReading(users[0],work,local('pdf',edition))).location).toEqual(location);
 expect((await db`SELECT count(*)::int total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before+1);
});

run('mark unread exits rereading, clears bookmarks and dates, and preserves its history',async()=>{
 const db=getSql(),edition='9'.repeat(64);
 const reread=await updateReading(users[0],work,{restart:true,state:'reading',page:0});
 const current=await prepareReading(users[0],work,local('pdf',edition));
 await moveReading(users[0],current.id,{format:'pdf',page:2,total:4});
 const before=(await db`SELECT count(*)::int total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total;
 const completed=await db`SELECT id FROM reading_history WHERE user_id=${users[0]} AND work_id=${work} AND state='completed' ORDER BY id`;
 const unread=await updateReading(users[0],work,{reset:'unread'});
 expect(unread).toMatchObject({state:'planned',page:0,totalPages:4,startedAt:null,completedAt:null,rereadRestore:null});
 expect(unread.bookmarkCycle).not.toBe(reread.bookmarkCycle);
 await expect(moveReading(users[0],current.id,{format:'pdf',page:3,total:4})).rejects.toMatchObject({status:410});
 expect((await prepareReading(users[0],work,local('pdf',edition))).location).toBeNull();
 expect(await db`SELECT id FROM reading_history WHERE user_id=${users[0]} AND work_id=${work} AND state='completed' ORDER BY id`).toEqual(completed);
 expect((await db`SELECT count(*)::int total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before+1);
 expect(await db`SELECT id FROM social_activity WHERE user_id=${users[0]} AND work_id=${work} AND event_kind='reading-planned' AND occurred_at=${unread.updatedAt}`).toHaveLength(1);
 expect(await updateReading(users[0],work,{endReread:reread.bookmarkCycle})).toEqual(unread);
 await updateReading(users[0],work,{reset:'unread'});
 expect((await db`SELECT count(*)::int total FROM reading_history WHERE user_id=${users[0]} AND work_id=${work}`)[0].total).toBe(before+1);
 await updateReading(users[0],work,{state:'reading',page:0,totalPages:4});
});

run('reading files share metadata but never grant another account cached availability',async()=>{
 const {observeReadingFile}=await import('../src/lib/catalogue/reading-files.server');
 const {readingCatalogue}=await import('../src/lib/reading/query.server');
 const {workSocial}=await import('../src/lib/social/queries.server');
  const {progressData}=await import('../src/lib/server/queries/progress');
 const {workAssessments,collectionData}=await import('../src/lib/collection/query.server');
 const sql=getSql(),instance=crypto.randomUUID(),connections=[crypto.randomUUID(),crypto.randomUUID()],generations=[crypto.randomUUID(),crypto.randomUUID()];
 await updateReading(users[0],work,{state:'reading',page:1,totalPages:4});
 await sql`INSERT INTO provider_instances(id,provider,name,base_url) VALUES(${instance},'jellyfin','Reading permissions fixture','https://fixture.invalid')`;
 try{
  for(let index=0;index<2;index++)await sql`INSERT INTO provider_connections(id,instance_id,user_id,status,account_generation) VALUES(${connections[index]},${instance},${users[index]},'connected',${generations[index]})`;
  const book={Id:'123456781234123412341234567890ab',Type:'Book' as const,Name:'Fixture',Path:'/books/fixture.pdf',Etag:'v1',ProviderIds:{}};
  const input={userId:users[0],connectionId:connections[0],instanceId:instance,generation:generations[0],workId:work,book,edition:'e'.repeat(64)};
  await observeReadingFile({...input,access:false});
  expect((await progressData(users[0],{category:'reading',view:'watching',scope:'available'})).items.map(item=>item.id)).not.toContain(work);
  expect((await readingCatalogue(users[0],{available:true})).items.map(item=>item.id)).not.toContain(work);
  await observeReadingFile(input);
  expect((await linkedReadingSources(users[0],work)).map(source=>source.externalId)).toContain(book.Id);
  // Shared metadata is a candidate only; the other account still needs a connected source.
  await sql`UPDATE provider_connections SET status='disconnected' WHERE id=${connections[1]}`;
  expect(await linkedReadingSources(users[1],work)).toEqual([]);
  await sql`UPDATE provider_connections SET status='connected' WHERE id=${connections[1]}`;
  await sql`UPDATE work_editions SET metadata=metadata||'{"identityConflict":true}'::jsonb WHERE work_id=${work} AND instance_id=${instance}`;
  expect(await linkedReadingSources(users[0],work)).toEqual([]);
  await sql`UPDATE work_editions SET metadata=metadata-'identityConflict' WHERE work_id=${work} AND instance_id=${instance}`;
  expect((await progressData(users[0],{category:'reading',view:'watching',scope:'available'})).items.map(item=>item.id)).toContain(work);
  expect((await readingCatalogue(users[0],{available:true})).items.map(item=>item.id)).toContain(work);
  expect((await readingCatalogue(users[1],{available:true})).items.map(item=>item.id)).not.toContain(work);
  const assessment=(await workAssessments(users[0],users[0],[work]))[0];
  expect(assessment.availability).toBe('available');expect(assessment.stale).toBe(false);
  expect((await workAssessments(users[1],users[1],[work]))[0].availability).toBe('unknown');
  const collection=await collectionData(users[0],{category:'reading',availability:'available',source:connections[0]});
  expect(collection.items.find(item=>item.id===work)?.available).toBe(true);
  expect((await collectionData(users[0],{category:'reading',availability:'available',source:connections[1]})).items).toEqual([]);
  await updateReading(users[0],work,{state:'paused'});
  expect((await collectionData(users[0],{category:'reading',activity:'reading'})).items.map(item=>item.id)).not.toContain(work);
  expect((await collectionData(users[0],{category:'reading',activity:'paused'})).items.map(item=>item.id)).toContain(work);
  await updateReading(users[0],work,{state:'reading'});
  expect((await collectionData(users[0],{category:'reading',activity:'reading'})).items.map(item=>item.id)).toContain(work);
  const {load}=await import('../src/routes/library/+page.server');
  const request=new Request(`http://coast/library?view=read&collection=true&activity=reading&scope=available&source=${connections[0]}`);
  const event={locals:{user:{id:users[0]}},depends:()=>{},request,url:new URL(request.url)};
  const page=await load(event as Parameters<typeof load>[0]);
  expect(page?.filters).toMatchObject({source:connections[0],scope:'available',availability:'available',activity:'reading'});
  expect(page?.content?.items.map(item=>item.id)).toContain(work);
  const {recommend,respondRecommendation}=await import('../src/lib/social/service.server');
  const {notificationInbox}=await import('../src/lib/server/notifications/inbox');
  const recommendation=await recommend(users[1],{recipientId:users[0],workId:work});
  expect((await progressData(users[0],{category:'reading',view:'recommendations',scope:'available'})).items.map(item=>item.id)).toContain(work);
  const actor={id:users[0],username:`reader-${users[0]}`,email:null,role:'user' as const,settings:{}};
  expect((await notificationInbox(actor,{kind:'recommendation',category:'reading'})).items.find(item=>item.media?.id===work)?.media?.availability).toBe('available');
  await respondRecommendation(users[0],recommendation.id,{action:'save'});
  await sql`UPDATE provider_connections SET status='disconnected' WHERE id=${connections[0]}`;
  expect((await workAssessments(users[0],users[0],[work]))[0].availability).toBe('unknown');
  expect((await collectionData(users[0],{category:'reading',availability:'available'})).items).toEqual([]);
  await sql`UPDATE provider_connections SET status='connected' WHERE id=${connections[0]}`;
  await expect(observeReadingFile({...input,workId:other})).rejects.toMatchObject({status:409});
  await sql`UPDATE provider_connections SET account_generation=gen_random_uuid() WHERE id=${connections[0]}`;
  await expect(observeReadingFile(input)).rejects.toMatchObject({status:410});
  await updateReading(users[1],work,{state:'completed',page:4,totalPages:4});
  expect((await workSocial(users[0],[work]))[work].friends.find(friend=>friend.userId===users[1])?.watched).toBe(true);
 }finally{await sql`DELETE FROM provider_instances WHERE id=${instance}`;}
});

run('unchanged linked reading files open without metadata lookups while changed identities still quarantine',async()=>{
 const connectionModule=await import('../src/lib/providers/jellyfin/connection.server');
 const metadata=await import('../src/lib/providers/reading.server');
 const {observeReadingFile}=await import('../src/lib/catalogue/reading-files.server');
 const {sourceEdition}=await import('../src/lib/reading/sessions.server');
 const {JellyfinAdapter}=await import('../src/lib/providers/jellyfin/adapter.server');
 const {encryptCredential}=await import('../src/lib/server/security/credentials');
 const sql=getSql(),instance=crypto.randomUUID(),connection=crypto.randomUUID();
 await sql`INSERT INTO provider_instances(id,provider,name,base_url,server_identity) VALUES(${instance},'jellyfin','Linked reader fixture','https://fixture.invalid',${instance})`;
 const credential=await encryptCredential(JSON.stringify({accessToken:'synthetic'}));
 await sql`INSERT INTO provider_connections(id,instance_id,user_id,status,external_user_id,credentials) VALUES(${connection},${instance},${users[0]},'connected','fixture-reader',${credential})`;
 await sql`INSERT INTO work_identifiers(work_id,provider,external_id,kind) VALUES(${work},'openlibrary','OL999871W','book') ON CONFLICT DO NOTHING`;
 const book={Id:'b'.repeat(32),Type:'Book' as const,Name:'Linked file',Path:'/fixture/book.epub',Etag:'v1',ProviderIds:{OpenLibrary:'OL2468M'}};
 const original=connectionModule.getJellyfin;let reads=0;
 const adapter=new JellyfinAdapter(async()=>{reads++;return book;},users[0],'synthetic');
 const accountSpy=spyOn(connectionModule,'getJellyfin').mockImplementation(async(user,id)=>({...await original(user,id),adapter}));
 const lookup=spyOn(metadata,'readingWorkForEdition').mockRejectedValue(new Error('Metadata service offline'));
 try{
  const [account]=await sql`SELECT account_generation FROM provider_connections WHERE id=${connection}`;
  await observeReadingFile({userId:users[0],connectionId:connection,instanceId:instance,generation:account.account_generation,workId:work,book,edition:sourceEdition(instance,book),reference:null});
  const session=await prepareReading(users[0],work,{source:'jellyfin',connectionId:connection,externalId:book.Id});
  expect(session.format).toBe('epub');expect(reads).toBe(1);expect(lookup).not.toHaveBeenCalled();
  book.Etag='v2';
  await expect(prepareReading(users[0],work,{source:'jellyfin',connectionId:connection,externalId:book.Id})).rejects.toThrow('Metadata service offline');
  expect(lookup).toHaveBeenCalledTimes(1);
  book.Etag='v1';book.ProviderIds.OpenLibrary='OL999872W';
  await expect(prepareReading(users[0],work,{source:'jellyfin',connectionId:connection,externalId:book.Id})).rejects.toMatchObject({status:409});
  expect(lookup).toHaveBeenCalledTimes(1);
  expect((await sql`SELECT metadata->>'identityConflict' AS conflict FROM work_editions WHERE instance_id=${instance}`)[0].conflict).toBe('true');
 }finally{accountSpy.mockRestore();lookup.mockRestore();await sql`DELETE FROM provider_instances WHERE id=${instance}`;}
});

run('Jellyfin readers revalidate own file access, versions and byte ranges before serving',async()=>{
 const connectionModule=await import('../src/lib/providers/jellyfin/connection.server');
 const transport=await import('../src/lib/server/security/provider-fetch');
 const {JellyfinAdapter}=await import('../src/lib/providers/jellyfin/adapter.server');
 const {encryptCredential}=await import('../src/lib/server/security/credentials');
 const {streamReading}=await import('../src/lib/reading/sessions.server');
 const {AppError}=await import('../src/lib/server/security/errors');
 const sql=getSql(),instance=crypto.randomUUID(),connection=crypto.randomUUID();
 await sql`INSERT INTO provider_instances(id,provider,name,base_url,server_identity) VALUES(${instance},'jellyfin','Reader file fixture','https://fixture.invalid',${instance})`;
 const credential=await encryptCredential(JSON.stringify({accessToken:'synthetic'}));
 await sql`INSERT INTO provider_connections(id,instance_id,user_id,status,external_user_id,credentials) VALUES(${connection},${instance},${users[0]},'connected','fixture-reader',${credential})`;
 const original=connectionModule.getJellyfin;
 let allowed=true,version='v1',downloads=0;
 const adapter=new JellyfinAdapter(async()=>{
  if(!allowed)throw new AppError(403,'File access denied.');
  return {Id:'f123456781234123412341234567890ab',Type:'Book',Name:'Private file',Path:'/private/books/file.pdf',Etag:version,ProviderIds:{}};
 },users[0],'synthetic');
 const accountSpy=spyOn(connectionModule,'getJellyfin').mockImplementation(async(user,id)=>({...await original(user,id),adapter}));
 const fetchSpy=spyOn(transport,'secureProviderFetch').mockImplementation(async(_config,path,init)=>{
  downloads++;expect(path).toBe('/Items/f123456781234123412341234567890ab/Download');
  expect(new Headers(init?.headers).get('range')).toBe('bytes=0-3');
  return new Response('%PDF',{status:206,headers:{'content-range':'bytes 0-3/10','content-length':'4','accept-ranges':'bytes'}});
 });
 try{
  const session=await prepareReading(users[0],other,{source:'jellyfin',connectionId:connection,externalId:'f123456781234123412341234567890ab'});
  expect(JSON.stringify(session)).not.toContain('/private/');expect(session.url).toBe(`/api/v1/reading/sessions/${session.id}/file`);
  const request=new Request('http://fixture/file',{headers:{Range:'bytes=0-3'}});
  const response=await streamReading(users[0],session.id,request);expect(response.status).toBe(206);expect(await response.text()).toBe('%PDF');expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(streamReading(users[1],session.id,request)).rejects.toMatchObject({status:410});
  await expect(streamReading(users[0],session.id,new Request('http://fixture/file',{headers:{Range:'bytes=0-1,3-4'}}))).rejects.toMatchObject({status:400});
  version='v2';await expect(streamReading(users[0],session.id,request)).rejects.toMatchObject({status:409});
  version='v1';allowed=false;await expect(streamReading(users[0],session.id,request)).rejects.toMatchObject({status:403});expect(downloads).toBe(1);
 }finally{accountSpy.mockRestore();fetchSpy.mockRestore();await sql`DELETE FROM provider_instances WHERE id=${instance}`;}
});

run('received reading recommendations use the shared row, own access and subtype gates',async()=>{
 const {recommend,respondRecommendation}=await import('../src/lib/social/service.server');
 const {notificationInbox,notificationUnread}=await import('../src/lib/server/notifications/inbox');
 const actor={id:users[0],username:`reader-${users[0]}`,email:null,role:'user' as const,settings:{}};
 const {progressData}=await import('../src/lib/server/queries/progress');
 const recommendation=await recommend(users[1],{recipientId:users[0],workId:other});
 const inbox=await notificationInbox(actor,{kind:'recommendation',category:'reading'});
 expect(inbox.items.map(item=>item.media?.id)).toContain(other);
 expect(inbox.unread).toBe(1);
 const unread=await notificationUnread(actor);
 const received=await progressData(users[0],{view:'recommendations',category:'reading',scope:'all'});
 expect(received.items.map(item=>item.id)).toContain(other);
 expect((await progressData(users[0],{view:'recommendations',category:'reading',scope:'available'})).items).toEqual([]);
 await expect(progressData(users[0],{view:'recommendations',category:'reading'},users[1])).rejects.toMatchObject({status:403});
 await saveConfig({...config,experimentalBooks:false,experimentalComics:true});
 try{
  expect((await progressData(users[0],{view:'recommendations',category:'reading'})).items).toEqual([]);
  expect((await notificationInbox(actor,{category:'reading'})).items).toEqual([]);
  expect(await notificationUnread(actor)).toBeLessThan(unread);
 }finally{await saveConfig({...config,experimentalBooks:true,experimentalComics:true,experimentalParties:true});}
 await respondRecommendation(users[0],recommendation.id,{action:'save'});
 expect((await getSql()`SELECT watchlist FROM tracking_state WHERE user_id=${users[0]} AND media_id=${other}`)[0].watchlist).toBe(true);
 expect((await notificationInbox(actor,{kind:'recommendation',category:'reading'})).items).toEqual([]);
});

run('preparation and Reread serialize bookmark copying with the same user lock',async()=>{
 const edition='f'.repeat(64),old=await prepareReading(users[0],work,local('pdf',edition));
 await moveReading(users[0],old.id,{format:'pdf',page:50,total:100});await updateReading(users[0],work,{state:'completed'});
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(done=>enter=done),released=new Promise<void>(done=>release=done);
 const db=getDb(),transaction=db.transaction.bind(db);let first=true;
 const boundary=spyOn(db,'transaction').mockImplementation((async(callback,options)=>{
  if(first){first=false;enter();await released;}
  return transaction(callback,options);
 }) as typeof db.transaction);
 let preparing:ReturnType<typeof prepareReading>|undefined;
 try{
  // Pause admission after external work, before its transaction can copy a bookmark.
  preparing=prepareReading(users[0],work,local('pdf',edition));await entered;
  await updateReading(users[0],work,{restart:true,state:'reading',page:0});release();
  const prepared=await preparing;expect(prepared.location).toBeNull();
  expect((await ownedReadingSession(users[0],prepared.id)).location).toBeNull();
 }finally{release();boundary.mockRestore();if(preparing)await preparing.catch(()=>{});}
});

run('reading handover preserves a live host after an intervening room read, without reviving expired membership',async()=>{
 const host=await prepareReading(users[0],work,local('pdf','1'.repeat(64))),guest=await prepareReading(users[1],work,local('pdf','1'.repeat(64)));
 let room=await createRoom(users[0],{readingSessionId:host.id});await inviteParticipant(users[0],room.id,{friendId:users[1]});
 room=await joinRoom(users[1],room.id,{readingSessionId:guest.id,revision:room.revision});
 const next=await prepareReading(users[0],other,local('pdf','2'.repeat(64)));
 await closeReading(users[0],host.id);room=await roomState(users[1],room.id);
 expect(room.participants.find(p=>p.userId===users[0])?.joined).toBe(false);
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'item',readingSessionId:next.id});
 expect(room.participants.find(p=>p.userId===users[0])?.joined).toBe(true);
 expect((await roomState(users[0],room.id,{buffering:false})).participants.find(p=>p.userId===users[0])?.joined).toBe(true);
 const another=await prepareReading(users[0],work,local('pdf','3'.repeat(64)));
 await getSql()`UPDATE reading_sessions SET expires_at=now()-interval '1 second',closed_at=now() WHERE id=${next.id}`;
 room=await roomState(users[1],room.id);
 await expect(commandRoom(users[0],room.id,{revision:room.revision,action:'item',readingSessionId:another.id})).rejects.toMatchObject({status:403});
 await getSql()`DELETE FROM synced_participants WHERE room_id=${room.id} AND user_id=${users[0]}`;
 await expect(commandRoom(users[0],room.id,{revision:room.revision,action:'item',readingSessionId:another.id})).rejects.toMatchObject({status:404});
});

run('an authorized reading controller hands over before retiring its own previous source',async()=>{
 const edition='4'.repeat(64),host=await prepareReading(users[0],work,local('pdf',edition)),guest=await prepareReading(users[1],work,local('pdf',edition));
 let room=await createRoom(users[0],{readingSessionId:host.id});await inviteParticipant(users[0],room.id,{friendId:users[1]});
 room=await joinRoom(users[1],room.id,{readingSessionId:guest.id,revision:room.revision});
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'settings',settings:{...room.settings,playback:'everyone'}});
 const next=await prepareReading(users[1],other,local('pdf','5'.repeat(64)));
 room=await commandRoom(users[1],room.id,{revision:room.revision,action:'item',readingSessionId:next.id});
 await closeReading(users[1],guest.id);room=await roomState(users[0],room.id);
 expect(room.participants.find(p=>p.userId===users[1])?.joined).toBe(true);
 room=await commandRoom(users[0],room.id,{revision:room.revision,action:'kick',userId:users[1]});
 const removed=await prepareReading(users[1],work,local('pdf','6'.repeat(64)));
 await expect(commandRoom(users[1],room.id,{revision:room.revision,action:'item',readingSessionId:removed.id})).rejects.toMatchObject({status:404});
});
