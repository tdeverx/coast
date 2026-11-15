import {beforeAll,afterAll,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {heartbeat,setStatus,setPresenceSharing} from '../src/lib/social/status.server';
import {friends,requestFriend,changeFriend} from '../src/lib/social/service.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const a=crypto.randomUUID(),b=crypto.randomUUID(),prefix='presence-'+crypto.randomUUID().slice(0,8);
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await getSql()`insert into users(id,username) values(${a},${prefix+'-a'}),(${b},${prefix+'-b'})`;const f=await requestFriend(a,{username:prefix+'-b'});await changeFriend(b,f.id,{action:'accept'});});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await getSql()`delete from users where id in (${a},${b})`;});
run('presence respects privacy, manual overrides, freshness and inactive tabs',async()=>{
 const db=getSql();
 expect((await heartbeat(a,{active:true})).status).toBe('online');
 await heartbeat(a,{active:false});
 expect((await friends(b))[0].activityStatus).toBe('online');
 await db`update user_presence set active_at=now()-interval '5 minutes' where user_id=${a}`;
 expect((await heartbeat(a,{active:false})).status).toBe('away');
 expect((await setStatus(a,{preference:'busy'})).status).toBe('busy');
 expect((await friends(b))[0]).toMatchObject({activityStatus:'busy',lastActiveAt:null});
 const [lastInput]=await db`update user_presence set heartbeat_at=now()-interval '90 seconds' where user_id=${a} returning active_at`;
 const offline=(await friends(b))[0];
 expect(offline.activityStatus).toBe('offline');
 expect(offline.lastActiveAt).not.toBeNull();
 expect(new Date(offline.lastActiveAt!).toISOString()).toBe(new Date(lastInput.active_at).toISOString());
 await setStatus(a,{preference:'invisible'});
 expect((await friends(b))[0]).toMatchObject({activityStatus:'offline',lastActiveAt:null});
 await setStatus(a,{preference:'automatic'});
 await db`update users set settings=jsonb_set(settings,'{social}',${{sections:{presence:'private'}}}::jsonb) where id=${a}`;
 expect((await friends(b))[0]).toMatchObject({activityStatus:'offline',lastActiveAt:null});
 for(const account of [a,b]){
  await db`update users set settings=${{features:{presence:false}}}::jsonb where id=${account}`;
  expect((await friends(b))[0]).toMatchObject({activityStatus:'offline',lastActiveAt:null});
  await db`update users set settings='{}'::jsonb where id=${account}`;
 }
 await db`update user_presence set active_at=null where user_id=${a}`;
 expect((await friends(b))[0]).toMatchObject({activityStatus:'offline',lastActiveAt:null});
 await expect(setStatus(a,{preference:'online'})).rejects.toThrow();
 await expect(heartbeat(a,{active:'true'})).rejects.toThrow();
});

run('last active stays private on a pending request even with a public presence audience',async()=>{
 const db=getSql(), outsider=crypto.randomUUID();
 await db`insert into users(id,username) values(${outsider},${prefix+'-outside'})`;
 try {
  await db`update users set settings=${{social:{sections:{presence:'public'}}}}::jsonb where id=${a}`;
  await db`insert into user_presence(user_id,heartbeat_at,active_at) values(${a},now()-interval '2 minutes',now()-interval '5 minutes')
   on conflict(user_id) do update set heartbeat_at=excluded.heartbeat_at,active_at=excluded.active_at`;
  await requestFriend(outsider,{username:prefix+'-a'});
  expect((await friends(outsider))[0]).toMatchObject({state:'pending',lastActiveAt:null});
 } finally {
  await db`delete from users where id=${outsider}`;
 }
});

run('live sharing toggle preserves feed settings and restores the previous presence audience',async()=>{
 const db=getSql();
 await db`update users set settings=${{social:{audience:'friends',sections:{presence:'public',activity:'friends',ratings:'private'}}}}::jsonb where id=${a}`;
 expect((await setPresenceSharing(a,{enabled:false})).sharePresence).toBe(false);
 let [row]=await db`select settings from users where id=${a}`;
 expect(row.settings.social.sections).toEqual({presence:'private',activity:'friends',ratings:'private'});
 expect((await setPresenceSharing(a,{enabled:true})).sharePresence).toBe(true);
 [row]=await db`select settings from users where id=${a}`;
 expect(row.settings.social.sections).toEqual({presence:'public',activity:'friends',ratings:'private'});
});
