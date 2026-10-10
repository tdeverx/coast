import {beforeAll,afterAll,test,expect,spyOn} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {getConfig,type CoastConfig} from '../src/lib/server/config';
import {prepareReading,moveReading,ownedReadingSession,closeReading,matchingReading} from '../src/lib/reading/sessions.server';
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

run('reading files share metadata but never grant another account cached availability',async()=>{
 const {observeReadingFile}=await import('../src/lib/catalogue/reading-files.server');
 const {readingCatalogue}=await import('../src/lib/reading/query.server');
 const {workSocial}=await import('../src/lib/social/queries.server');
  const {progressData}=await import('../src/lib/server/queries/progress');
 const {workAssessments,collectionData}=await import('../src/lib/collection/query.server');
 const sql=getSql(),instance=crypto.randomUUID(),connections=[crypto.randomUUID(),crypto.randomUUID()],generations=[crypto.randomUUID(),crypto.randomUUID()];
 await sql`INSERT INTO provider_instances(id,provider,name,base_url) VALUES(${instance},'jellyfin','Reading permissions fixture','https://fixture.invalid')`;
 try{
  for(let index=0;index<2;index++)await sql`INSERT INTO provider_connections(id,instance_id,user_id,status,account_generation) VALUES(${connections[index]},${instance},${users[index]},'connected',${generations[index]})`;
  const book={Id:'123456781234123412341234567890ab',Type:'Book' as const,Name:'Fixture',Path:'/books/fixture.pdf',Etag:'v1',ProviderIds:{}};
  const input={userId:users[0],connectionId:connections[0],instanceId:instance,generation:generations[0],workId:work,book,edition:'e'.repeat(64)};
  await observeReadingFile({...input,access:false});
  expect((await progressData(users[0],{category:'reading',view:'watching',scope:'available'})).items.map(item=>item.id)).not.toContain(work);
  expect((await readingCatalogue(users[0],{available:true})).items.map(item=>item.id)).not.toContain(work);
  await observeReadingFile(input);
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
