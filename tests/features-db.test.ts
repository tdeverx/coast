import {beforeAll,afterAll,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {defaultConfig} from '../src/lib/server/config';
import {featureDefinitions,featureValues} from '../src/lib/features';
import {getFeatureConfig,requireFeature} from '../src/lib/server/features';
import {updateUserSettings,resetUserSettings,type SessionUser} from '../src/lib/server/auth';
import {notify,inbox} from '../src/lib/server/notifications';
import {notificationUnread} from '../src/lib/server/notifications/inbox';
import {heartbeat} from '../src/lib/social/status.server';
import {interestWorks} from '../src/lib/recommendations/interests.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const a=crypto.randomUUID(),b=crypto.randomUUID();let original:unknown;
const actor={id:a,username:'feature-fixture-a',role:'admin',settings:{}} as SessionUser;
const config={...defaultConfig,experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,experimentalParties:true,experimentalPlanning:true,experimentalMediaModal:true,allowPlaybackSharing:true};
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();original=(await db`select value from system_settings where key='coast'`)[0]?.value;await db`insert into users(id,username,role) values(${a},${actor.username},'admin'),(${b},'feature-fixture-b','user')`;await db`insert into system_settings(key,value) values('coast',${config}::jsonb) on conflict(key) do update set value=excluded.value`;});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();await db`delete from users where id in (${a},${b})`;if(original)await db`update system_settings set value=${original}::jsonb where key='coast'`;else await db`delete from system_settings where key='coast'`;});
run('SQL and application policies agree for two users, guest, all gates and prerequisites',async()=>{
 const db=getSql();
 for(const choices of [{},{social:false},{screen:false,music:false},{playback:false},{personalisation:false,reader:false,planning:false}]){
  await db`update users set settings=${{features:choices}}::jsonb where id=${a}`;
  const expected=featureValues(config,choices);
  for(const [key] of featureDefinitions){const [row]=await db`select coast_feature_enabled(${a}::uuid,${key}) as enabled`;expect(row.enabled).toBe(expected[key]);}
  expect((await getFeatureConfig(a)).features).toEqual(expected);
  expect((await getFeatureConfig(b)).features).toEqual(featureValues(config));
 }
 await db`update users set settings='{}'::jsonb where id=${a}`;
});
run('partial feature saves retain other choices and appearance reset preserves opt-outs',async()=>{
 await updateUserSettings(actor,{features:{music:false,social:false}});
 await updateUserSettings(actor,{features:{reader:false}});
 expect((await getFeatureConfig(a)).features.music).toBe(false);expect((await getFeatureConfig(a)).features.social).toBe(false);
 await resetUserSettings(actor);
 expect((await getFeatureConfig(a)).features.reader).toBe(false);
 await expect(heartbeat(a,{active:true})).rejects.toThrow('disabled');
 await expect(requireFeature(a,'parties')).rejects.toThrow('disabled');
 const [inspection]=await getSql()`select coast_job_allowed(${a}::uuid,'jellyfin.streams','{}'::jsonb) as allowed`;
 expect(inspection.allowed).toBe(true);
});
run('optional notices agree between creation, toast inbox and unread badge while system recovery survives',async()=>{
 await notify({userId:a,kind:'friend-accepted',title:'Hidden social',sourceKey:'feature-social',data:{actorId:b,subjectId:b,destination:'/for-you?friends=true'}});
 await notify({userId:a,kind:'administrator',title:'Required recovery',sourceKey:'feature-system',locked:true});
 const items=await inbox(actor);expect(items.map(item=>item.title)).toEqual(['Required recovery']);
 expect(await notificationUnread(actor)).toBe(1);
});
run('opted-out users contribute no shared recommendation seeds',async()=>{
 const db=getSql(),[work]=await db`insert into media(kind,title) values('movie','Feature private taste') returning id`;
 try{
  await db`insert into tracking_state(user_id,media_id,favourite) values(${a},${work.id},true)`;
  await db`update users set settings=settings||${{features:{personalisation:false}}}::jsonb where id=${a}`;
  expect((await interestWorks(a)).map(work=>work.id)).not.toContain(work.id);
  expect((await interestWorks(null)).map(work=>work.id)).not.toContain(work.id);
 }finally{await db`delete from works where id=${work.id}`;}
});
run('Social opt-out leaves public profile privacy independent, while withdrawn media stays hidden',async()=>{
 const db=getSql();
 await db`update users set settings=${{features:{social:false},social:{audience:'public'}}}::jsonb where id=${a}`;
 const [row]=await db`select social_visible(${a}::uuid,null,'details') as profile, social_visible(${a}::uuid,${b}::uuid,'presence') as presence`;
 expect(row.profile).toBe(true);expect(row.presence).toBe(false);
 await db`update users set settings=${{features:{social:false,screen:false},social:{audience:'public'}}}::jsonb where id=${a}`;
 const [media]=await db`select social_visible(${a}::uuid,null,'activity','screen') as allowed`;
 expect(media.allowed).toBe(false);
});
run('withdrawal drains more than one reader/job batch without erasing data or replaying disabled backlog',async()=>{
 const db=getSql();
 const [work]=await db`insert into works(category,kind) values('book','book') returning id`;
 await db`insert into reading_works(id,provider,external_id,kind,title,source_url) values(${work.id},'openlibrary','OL900000099W','book','Retained reading','https://openlibrary.org/works/OL900000099W')`;
 try{
  await db`insert into reading_sessions(user_id,work_id,format,edition,expires_at) select ${a}::uuid,${work.id}::uuid,'pdf','fixture',now()+interval '1 day' from generate_series(1,205)`;
  await db`insert into outbox_actions(user_id,kind,payload) select ${a}::uuid,'planning.reminder','{}'::jsonb from generate_series(1,205)`;
  const cutoff=(await db`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`)[0].at;
  const {reconcileFeatures}=await import('../src/lib/application/feature-transition.server');
  await reconcileFeatures({id:crypto.randomUUID(),userId:a,connectionId:null,kind:'feature.reconcile',attempts:1,correlationId:'fixture',payload:{config,subjectId:a,choices:{reader:false,planning:false},cutoff}});
  const [row]=await db`select (select count(*)::int from reading_sessions where user_id=${a} and work_id=${work.id} and closed_at is not null) as closed,(select count(*)::int from outbox_actions where user_id=${a} and kind='planning.reminder' and state='cancelled') as cancelled`;
  expect(row.closed).toBe(205);expect(row.cancelled).toBe(205);
  expect((await db`select title from reading_works where id=${work.id}`)[0].title).toBe('Retained reading');
 }finally{await db`delete from works where id=${work.id}`;}
});
run('administrator ceilings retain personal choices and reject role bypass without queuing empty cleanup',async()=>{
 const db=getSql(),{updateConfig}=await import('../src/lib/application/configuration.server');
 await db`update users set settings=${{features:{music:false}}}::jsonb where id=${a}`;
 const originalCount=(await db`select count(*)::int as count from outbox_actions where kind='feature.reconcile'`)[0].count;
 await updateConfig(actor,{features:{social:false,playback:false}});
 expect((await getFeatureConfig(a)).features.social).toBe(false);
 await expect(requireFeature(a,'playback')).rejects.toMatchObject({code:'feature_disabled'});
 await updateConfig(actor,{features:{social:true}});
 expect((await getFeatureConfig(a)).features.playback).toBe(false);
 await updateConfig(actor,{features:{playback:true}});
 expect((await getFeatureConfig(a)).features.music).toBe(false);
 expect((await db`select count(*)::int as count from outbox_actions where kind='feature.reconcile'`)[0].count).toBe(originalCount);
});
run('an already-open local reader rejects page writes after withdrawal but still closes safely',async()=>{
 const db=getSql(),{importReading}=await import('../src/lib/catalogue/reading.server');
 const {prepareReading,moveReading,closeReading}=await import('../src/lib/reading/sessions.server');
 await db`update users set settings='{}'::jsonb where id=${a}`;
 const book=await importReading({provider:'openlibrary',externalId:'OL900000010W',kind:'book',title:'Reader withdrawal',authors:[],subjects:[],sourceUrl:'https://openlibrary.org/works/OL900000010W'});
 try{
  const session=await prepareReading(a,book.id,{source:'local',format:'pdf',edition:'a'.repeat(64)});
  await db`update users set settings=${{features:{reader:false}}}::jsonb where id=${a}`;
  await expect(moveReading(a,session.id,{format:'pdf',page:5,total:100})).rejects.toMatchObject({code:'feature_disabled'});
  expect(await closeReading(a,session.id)).toEqual({closed:true});
  const [state]=await db`select closed_at,location from reading_sessions where id=${session.id}`;
  expect(state.closed_at).not.toBeNull();expect(state.location).toBeNull();
 }finally{await db`delete from works where id=${book.id}`;}
});

run('API withdrawal rejects existing tokens and new issuance while owner revocation remains available',async()=>{
 const db=getSql(),{createApiToken,authenticateApiToken,listApiTokens,revokeApiToken}=await import('../src/lib/server/public-api/tokens.server');
 const token=await createApiToken(actor,{name:'Feature policy fixture',scopes:['catalogue:read']});
 const request=()=>new Request('https://coast.test',{headers:{authorization:`Bearer ${token.token}`}});
 await db`update system_settings set value=jsonb_set(value,'{features}','{"api":false}'::jsonb) where key='coast'`;
 try{
  await expect(authenticateApiToken(request())).rejects.toMatchObject({code:'feature_disabled'});
  await expect(createApiToken(actor,{name:'Denied',scopes:['catalogue:read']})).rejects.toMatchObject({code:'feature_disabled'});
  expect((await listApiTokens(actor)).map((row:{id:string})=>row.id)).toContain(token.id);
  await revokeApiToken(actor,token.id);
 }finally{await db`update system_settings set value=${config}::jsonb where key='coast'`;}
 await expect(authenticateApiToken(request())).rejects.toMatchObject({code:'invalid_token'});
});
run('Reader withdrawal retains manual book tracking and book withdrawal rejects it',async()=>{
 const db=getSql(),{importReading}=await import('../src/lib/catalogue/reading.server'),{updateReading}=await import('../src/lib/core/reading/service.server');
 await db`update users set settings=${{features:{reader:false}}}::jsonb where id=${a}`;
 const book=await importReading({provider:'openlibrary',externalId:'OL900000011W',kind:'book',title:'Manual reading remains',authors:[],subjects:[],sourceUrl:'https://openlibrary.org/works/OL900000011W'});
 try{
  expect((await updateReading(a,book.id,{state:'reading',page:2,totalPages:100})).page).toBe(2);
  await db`update users set settings=${{features:{reader:false,book:false}}}::jsonb where id=${a}`;
  await expect(updateReading(a,book.id,{page:3})).rejects.toMatchObject({code:'feature_disabled'});
  expect((await db`select page from reading_progress where user_id=${a} and work_id=${book.id}`)[0].page).toBe(2);
 }finally{await db`delete from works where id=${book.id}`;}
});

run('an idle party does not need Playback, and party withdrawal still permits leaving',async()=>{
 const db=getSql(),{createRoom,listRooms,leaveRoom}=await import('../src/lib/playback/synced/service.server');
 await db`update users set settings=${{features:{playback:false}}}::jsonb where id=${a}`;
 const room=await createRoom(a,{});expect(room.id).toBeTruthy();
 await db`update users set settings=${{features:{playback:false,parties:false}}}::jsonb where id=${a}`;
 await expect(listRooms(a)).rejects.toMatchObject({code:'feature_disabled'});
 expect(await leaveRoom(a,room.id)).toEqual({left:true});
 expect((await db`select joined from synced_participants where room_id=${room.id} and user_id=${a}`)[0].joined).toBe(false);
});

run('Jobs does not advertise next runs for withdrawn shared catalogue and recommendation work',async()=>{
 const db=getSql(),id=crypto.randomUUID(),{jobTimings}=await import('../src/lib/providers/job-timing.server');
 await db`insert into provider_instances(id,provider,name,base_url,credentials) values(${id},'tmdb','Feature job timing','https://fixture.invalid','fixture')`;
 await db`update system_settings set value=jsonb_set(value,'{features}','{"screen":false,"personalisation":false}'::jsonb) where key='coast'`;
 try{
  const timings=(await jobTimings()).filter(row=>row.instanceId===id&&['tmdb.refresh','tmdb.recommendations'].includes(row.kind));
  expect(timings).toHaveLength(2);for(const timing of timings){expect(timing.nextAt).toBeNull();expect(timing.reason).toBe('Disabled in feature settings');}
 }finally{await db`delete from provider_instances where id=${id}`;await db`update system_settings set value=${config}::jsonb where key='coast'`;}
});
