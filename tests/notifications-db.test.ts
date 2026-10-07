import {beforeAll,afterAll,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {notificationInbox,notificationUnread,markNotification,markNotificationsRead,markNotificationsSeen} from '../src/lib/server/notifications/inbox';
import {incomingFriendRequests} from '../src/lib/social/service.server';
import {notify,inbox} from '../src/lib/server/notifications';
import type {SessionUser} from '../src/lib/server/auth';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user:SessionUser={id:crypto.randomUUID(),username:'notifications-'+crypto.randomUUID().slice(0,8),email:null,role:'user',settings:{}};
const other:SessionUser={...user,id:crypto.randomUUID(),username:user.username+'-other'};
const work=crypto.randomUUID();
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();for(const u of [user,other])await db`insert into users(id,username) values(${u.id},${u.username})`;await db`insert into works(id,category,kind) values(${work},'screen','movie')`;await db`insert into media(id,kind,title) values(${work},'movie','Notification fixture')`;});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();await db`delete from users where id in (${user.id},${other.id})`;await db`delete from media where id=${work}`;await db`delete from works where id=${work}`;});
run('incoming friend requests belong to Friends, while acceptance remains in notifications',async()=>{
 const db=getSql(),[a,b]=[user.id,other.id].sort();
 await db`insert into friendships(user_a,user_b,requested_by,state) values(${a},${b},${other.id},'pending')`;
 await notify({userId:user.id,kind:'friend-request',title:'Legacy request',sourceKey:'legacy-request'});
 expect(await incomingFriendRequests(user.id)).toBe(1);
 expect(await incomingFriendRequests(other.id)).toBe(0);
 expect((await notificationInbox(user)).items).toHaveLength(0);
 expect(await notificationUnread(user)).toBe(0);
 expect(await inbox(user)).toHaveLength(0);
 await notify({userId:user.id,kind:'friend-accepted',title:'Accepted',sourceKey:'accepted-fixture'});
 expect((await notificationInbox(user)).items.map(item=>item.kind)).toEqual(['friend-accepted']);
 await db`delete from friendships where user_a=${a} and user_b=${b}`;
 await db`delete from notifications where user_id=${user.id}`;
});
run('recommendations resolve their media and accepted notices reuse the friend entry',async()=>{
 const db=getSql(),[a,b]=[user.id,other.id].sort();
 await db`insert into friendships(user_a,user_b,requested_by,state) values(${a},${b},${other.id},'accepted')`;
 const [rec]=await db`insert into social_recommendations(sender_id,recipient_id,work_id) values(${other.id},${user.id},${work}) returning id`;
 try{
  await notify({userId:user.id,kind:'recommendation',title:'Recommended',sourceKey:'recommendation-fixture',data:{actorId:other.id,subjectId:rec.id,destination:'/for-you?notifications=true'}});
  await notify({userId:user.id,kind:'friend-accepted',title:'Accepted',sourceKey:'friend-card-fixture',data:{actorId:other.id,subjectId:rec.id,destination:'/for-you?friends=true'}});
  const feed=await notificationInbox(user);
  expect(feed.items.find(n=>n.kind==='recommendation')?.media?.card.id).toBe(work);
  expect(feed.items.find(n=>n.kind==='friend-accepted')?.friend?.username).toBe(other.username);
 }finally{
  await db`delete from notifications where user_id=${user.id}`;
  await db`delete from social_recommendations where id=${rec.id}`;
  await db`delete from friendships where user_a=${a} and user_b=${b}`;
 }
});
run('notification artwork prefers Thumb and falls back to backdrop',async()=>{
 const db=getSql();
 const [snapshot]=await db`insert into metadata_snapshots(media_id,provider,raw) values(${work},'tmdb',${{artwork:{thumb:'/fixture-thumb.jpg',backdrop:'/fixture-backdrop.jpg'}}}::jsonb) returning id`;
 try{
  await notify({userId:user.id,kind:'availability',title:'Available',sourceKey:'available:'+work});
  expect((await notificationInbox(user)).items[0].media?.artwork).toBe('/fixture-thumb.jpg');
  await db`update metadata_snapshots set raw=${{artwork:{backdrop:'/fixture-backdrop.jpg'}}}::jsonb where id=${snapshot.id}`;
  expect((await notificationInbox(user)).items[0].media?.artwork).toBe('/fixture-backdrop.jpg');
 }finally{
  await db`delete from metadata_snapshots where id=${snapshot.id}`;
  await db`delete from notifications where user_id=${user.id}`;
 }
});
run('true counts, deterministic cursors, filters before pagination and ownership',async()=>{
 const db=getSql();for(let i=0;i<65;i++)await notify({userId:user.id,kind:'administrator',title:`Notice ${i}`,sourceKey:'notice:'+i});
 await notify({userId:user.id,kind:'availability',title:'Now available',sourceKey:'available:'+work});
 expect(await notificationUnread(user)).toBe(66);
 const first=await notificationInbox(user);expect(first.items).toHaveLength(60);expect(first.hasMore).toBe(true);expect(first.unread).toBe(66);
 const next=await notificationInbox(user,first.next!);expect(next.items).toHaveLength(6);expect(next.hasMore).toBe(false);expect(new Set([...first.items,...next.items].map(n=>n.id)).size).toBe(66);
 const screen=await notificationInbox(user,{category:'screen'});expect(screen.items).toHaveLength(1);expect(screen.items[0].media?.title).toBe('Notification fixture');expect(screen.items[0].media?.availability).toBe('unknown');
 const requests=await notificationInbox(user,{segment:'requests'});expect(requests.items).toHaveLength(1);expect(requests.unread).toBe(1);
 await expect(markNotification(other,first.items[0].id,'read')).rejects.toThrow();expect((await notificationInbox(other)).items).toHaveLength(0);
 await markNotificationsRead(user,{segment:'requests',snapshot:requests.snapshot});expect(await notificationUnread(user)).toBe(65);
 expect((await notificationInbox(user,{segment:'requests',unread:true})).items).toHaveLength(0);
 await db`delete from notifications where user_id=${user.id}`;
});
run('reaction notices remain individual and read/dismiss affect only their target',async()=>{
 const db=getSql(),events:string[]=[];
 // Self reactions are valid visible activity, avoiding unrelated friendship dependencies.
 for(let i=0;i<23;i++){
  const id=crypto.randomUUID();events.push(id);
  await db`insert into social_activity(id,user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${id},${user.id},${work},${'reaction-'+i},'watch','activity','coast',now())`;
  await db`insert into social_reactions(user_id,target_kind,target_id,emoji) values(${user.id},'activity',${id},'❤️')`;
  await notify({userId:user.id,kind:'reaction',title:'Reacted ❤️ to your activity',sourceKey:'reaction:'+id,data:{actorId:user.id,subjectId:id,workId:work,destination:'/for-you?section=activity'}});
 }
 const feed=await notificationInbox(user);expect(feed.items).toHaveLength(23);expect(feed.items[0].reaction).toBe('❤️');expect(feed.items[0].activity?.captionActivity?.kind).toBe('watch');
 expect((await markNotification(user,feed.items[0].id,'read')).updated).toBe(1);expect(await notificationUnread(user)).toBe(22);
 expect((await markNotification(user,feed.items[0].id,'dismiss')).updated).toBe(1);expect((await notificationInbox(user)).items).toHaveLength(22);
 await db`delete from notifications where user_id=${user.id}`;
});
run('read-all respects snapshot and cannot mark future notifications read',async()=>{
 const before=(await notificationInbox(user)).snapshot;await notify({userId:user.id,kind:'administrator',title:'New after snapshot',sourceKey:'snapshot-new'});
 await markNotificationsRead(user,{snapshot:before});expect(await notificationUnread(user)).toBe(1);
 await expect(notificationInbox(user,{before:'2026-01-01T00:00:00.000Z'})).rejects.toThrow();
});
run('individual notices enforce current reaction privacy',async()=>{
 const db=getSql();await db`delete from notifications where user_id=${user.id}`;
 const [a,b]=[user.id,other.id].sort();await db`insert into friendships(user_a,user_b,requested_by,state) values(${a},${b},${other.id},'accepted')`;
 const event=crypto.randomUUID();await db`insert into social_activity(id,user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${event},${user.id},${work},'private-reaction','watch','activity','coast',now())`;
 await db`insert into social_reactions(user_id,target_kind,target_id,emoji) values(${other.id},'activity',${event},'🔥')`;
 await notify({userId:user.id,kind:'reaction',title:'Reacted 🔥',sourceKey:'privacy-reaction',data:{actorId:other.id,subjectId:event,workId:work,destination:'/for-you?section=activity'}});
 const feed=await notificationInbox(user);expect(feed.items).toHaveLength(1);expect(feed.items[0].actor?.username).toBe(other.username);
 await db`update users set settings=${{social:{sections:{reactions:'private'}}}}::jsonb where id=${other.id}`;
 expect(await notificationUnread(user)).toBe(0);expect((await notificationInbox(user)).items).toHaveLength(0);
 await expect(markNotification(user,feed.items[0].id,'dismiss')).rejects.toThrow();
});
run('request updates are separate and ordered by notification date',async()=>{
 const request=crypto.randomUUID();for(const state of ['pending','approved','available'])await notify({userId:user.id,kind:'request',title:`Request ${state}`,sourceKey:`request-fixture:${state}`,data:{actorId:user.id,subjectId:request,workId:work,destination:'/requests'}});
 const feed=await notificationInbox(user,{segment:'requests'});expect(feed.items).toHaveLength(3);expect(feed.items[0].title).toBe('Request available');
 expect(feed.items.map(n=>n.title)).toEqual(['Request available','Request approved','Request pending']);
});
run('service failures stay individual and link to their job card',async()=>{
 const db=getSql(),instance=crypto.randomUUID(),connection=crypto.randomUUID();
 await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Fixture Jellyfin','http://localhost:8096')`;
 await db`insert into provider_connections(id,user_id,instance_id) values(${connection},${user.id},${instance})`;
 try{
  for(let i=0;i<3;i++){
   const id=crypto.randomUUID();
   await db`insert into outbox_actions(id,user_id,connection_id,kind,payload,state) values(${id},${user.id},${connection},'jellyfin.sync',${{_jobFailure:{code:i===2?'connection':'permissions'}}}::jsonb,'failed')`;
   await notify({userId:user.id,kind:'external-action',title:'Needs attention',sourceKey:'outbox:'+id});
  }
  const feed=await notificationInbox(user,{kind:'external-action'});expect(feed.items).toHaveLength(3);
  expect(feed.items.every(n=>n.destination===`/settings/jobs#job-${instance}-jellyfin.sync`)).toBe(true);
  expect(feed.items.every(n=>n.sourceLabel?.startsWith('Fixture Jellyfin'))).toBe(true);
  const unreadBefore=await notificationUnread(user);
  await db`update outbox_actions set state='cancelled' where connection_id=${connection} and payload->'_jobFailure'->>'code'='permissions'`;
  expect((await notificationInbox(user,{kind:'external-action'})).items).toHaveLength(1);
  expect(await notificationUnread(user)).toBe(unreadBefore-2);
  await db`update outbox_actions set state='succeeded' where connection_id=${connection}`;
  expect((await notificationInbox(user,{kind:'external-action'})).items).toHaveLength(0);
  expect(await inbox(user,50,{kind:'external-action'})).toHaveLength(0);

  await expect(markNotification(user,feed.items[0].id,'read')).rejects.toThrow();
 }finally{await db`delete from provider_instances where id=${instance}`;}
});

run('visible-read batches affect only the specified accessible owned notifications',async()=>{
 const db=getSql();await db`delete from notifications where user_id in (${user.id},${other.id})`;
 for(const [owner,key] of [[user.id,'seen-one'],[user.id,'unseen-two'],[other.id,'other-seen']])await notify({userId:owner,kind:'administrator',title:key,sourceKey:key});
 const own=(await notificationInbox(user)).items,foreign=(await notificationInbox(other)).items;
 const result=await markNotificationsSeen(user,{ids:[own[0].id,foreign[0].id]});
 expect(result.ids).toEqual([own[0].id]);expect(await notificationUnread(user)).toBe(1);expect(await notificationUnread(other)).toBe(1);
 expect((await notificationInbox(user)).items.find(n=>n.id===own[1].id)?.readAt).toBeNull();
 await expect(markNotificationsSeen(user,{ids:Array(61).fill(own[0].id)})).rejects.toThrow();
});
