import {progressData} from '../src/lib/server/queries/progress';
import {beforeAll,afterAll,test,expect} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {friends,requestFriend,changeFriend,react,recommend,respondRecommendation} from '../src/lib/social/service.server';
import {activityFeed,workSocial,reactionSummary} from '../src/lib/social/queries.server';
import {canView} from '../src/lib/social/privacy.server';
import {startCheckin,cancelCheckin,completeCheckin} from '../src/lib/social/presence.server';
import {friendInsights} from '../src/lib/social/insights.server';
import {reconcileProviderValue} from '../src/lib/sync/values';
import {track} from '../src/lib/core/tracking/service';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()],work=crypto.randomUUID(),prefix='social-'+crypto.randomUUID().slice(0,8);let friendId:string;
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();for(let i=0;i<ids.length;i++)await db`insert into users(id,username) values(${ids[i]},${prefix+'-'+i})`;await db`insert into works(id,category,kind) values(${work},'screen','movie')`;await db`insert into media(id,kind,title,runtime_minutes,genres) values(${work},'movie','Social fixture',1,array['Drama'])`;});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const db=getSql();await db`delete from users where id in ${db(ids)}`;await db`delete from media where id=${work}`;await db`delete from works where id=${work}`;});
run('case-insensitive requests are deduplicated and default sharing is friends only',async()=>{
 expect(await canView(ids[0],ids[1],'activity')).toBe(false);
 const requests=await Promise.all([requestFriend(ids[0],{username:(prefix+'-1').toUpperCase()}),requestFriend(ids[0],{username:prefix+'-1'})]);
 expect(requests[0].id).toBe(requests[1].id);friendId=requests[0].id;
 expect((await friends(ids[0],1,'pending')).map(friend=>friend.id)).toEqual([friendId]);
 expect(await friends(ids[0],1,'accepted')).toHaveLength(0);
 await expect(changeFriend(ids[0],friendId,{action:'accept'})).rejects.toThrow();
 await changeFriend(ids[1],friendId,{action:'accept'});expect(await canView(ids[0],ids[1],'activity')).toBe(true);
 expect(await friends(ids[0],1,'pending')).toHaveLength(0);
 expect((await friends(ids[0],1,'accepted')).map(friend=>friend.id)).toEqual([friendId]);
 expect(await canView(ids[0],null,'activity')).toBe(false);
});
run('canonical activity appears once and private categories cannot leak through indicators',async()=>{
 await track(ids[0],{mediaId:work,action:'watch',sourceEventId:'social-fixture-watch'});
 await track(ids[0],{mediaId:work,action:'watch',sourceEventId:'social-fixture-watch'});
 const feed=await activityFeed(ids[1]);expect(feed.events.filter(e=>e.workId===work)).toHaveLength(1);
 expect((await workSocial(ids[1],[work]))[work].total).toBe(1);
 await getSql()`update users set settings=jsonb_set(settings,'{social}',${{audience:'friends',categories:{screen:'private'}}}::jsonb) where id=${ids[0]}`;
 expect((await activityFeed(ids[1])).events.filter(e=>e.workId===work)).toHaveLength(0);
 expect((await workSocial(ids[1],[work]))[work].total).toBe(0);
 await getSql()`update users set settings='{}'::jsonb where id=${ids[0]}`;
});
run('reaction replacement and recommendation responses retain one durable result',async()=>{
 await react(ids[0],{targetKind:'work',targetId:work,emoji:'❤️'});await react(ids[0],{targetKind:'work',targetId:work,emoji:'🔥'});
 const reactions=await getSql()`select emoji from social_reactions where user_id=${ids[0]} and target_id=${work}`;expect(reactions).toHaveLength(1);expect(reactions[0].emoji).toBe('🔥');
 const rec=await recommend(ids[0],{recipientId:ids[1],workId:work});expect((await recommend(ids[0],{recipientId:ids[1],workId:work})).id).toBe(rec.id);
 await respondRecommendation(ids[1],rec.id,{action:'save'});await respondRecommendation(ids[1],rec.id,{action:'save'});
 expect((await getSql()`select watchlist from tracking_state where user_id=${ids[1]} and media_id=${work}`)[0].watchlist).toBe(true);
});
run('check-in cancellation and repeated completion cannot manufacture extra watches',async()=>{
 const c=await startCheckin(ids[2],{workId:work});await cancelCheckin(ids[2],c.id);await completeCheckin(ids[2],c.id);
 expect((await getSql()`select id from tracking_events where user_id=${ids[2]} and action='watch'`)).toHaveLength(0);
 const next=await startCheckin(ids[2],{workId:work});await getSql()`update social_checkins set expires_at=now()-interval '1 second' where id=${next.id}`;
 await Promise.all([completeCheckin(ids[2],next.id),completeCheckin(ids[2],next.id)]);
 expect((await getSql()`select id from tracking_events where user_id=${ids[2]} and action='watch'`)).toHaveLength(1);
});
run('imported watches remain ordinary dated activity without exposing private members',async()=>{
 const db=getSql(),batch='social-import-'+crypto.randomUUID();
 for(let i=0;i<21;i++)await db`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,batch_key,occurred_at) values(${ids[0]},${work},${batch+':'+i},'watch','activity','trakt',${batch},now()-interval '2 years')`;
 try{
  const imports=(await activityFeed(ids[1])).events.filter(e=>e.workId===work && new Date(e.occurredAt).getFullYear()===new Date().getFullYear()-2);
  expect(imports).toHaveLength(21);expect(imports.every(e=>e.eventKind==='watch'&&e.count===1)).toBe(true);
  await db`update users set settings=${{social:{sections:{activity:'private'}}}}::jsonb where id=${ids[0]}`;
  expect((await activityFeed(ids[1])).events.filter(e=>e.workId===work && new Date(e.occurredAt).getFullYear()===new Date().getFullYear()-2)).toHaveLength(0);
 }finally{await db`delete from social_activity where batch_key=${batch}`;await db`update users set settings='{}'::jsonb where id=${ids[0]}`;}
});
run('private favourites do not erase an independently shared collection relationship',async()=>{
 const db=getSql();
 await track(ids[0],{mediaId:work,action:'collect',value:true});
 await track(ids[0],{mediaId:work,action:'favourite',value:true});
 await db`update users set settings=${{social:{sections:{favourites:'private',collection:'friends',activity:'private',ratings:'private',progress:'private'}}}}::jsonb where id=${ids[0]}`;
 try{expect((await workSocial(ids[1],[work]))[work].total).toBe(1);}
 finally{await db`update users set settings='{}'::jsonb where id=${ids[0]}`;}
});
run('taste and overlap respect privacy and reaction reads retain only one selection',async()=>{
 const result=await friendInsights(ids[1],ids[0]);
 const movie=result.media.find(m=>m.medium==='movies')!;
 expect(movie.overlap.shared).toContain(work);expect(movie.score).toBeNull();
 const summary=await reactionSummary(ids[0],'work',[work]);
 expect(summary[work].filter(r=>r.mine).map(r=>r.emoji)).toEqual(['🔥']);
 await getSql()`update users set settings=${{social:{sections:{insights:'private'}}}}::jsonb where id=${ids[0]}`;
 try{await expect(friendInsights(ids[1],ids[0])).rejects.toThrow();}
 finally{await getSql()`update users set settings='{}'::jsonb where id=${ids[0]}`;}
});
run('a live response from a replaced account cannot write tracking or baselines',async()=>{
 const db=getSql(),instance=crypto.randomUUID(),connection=crypto.randomUUID();
 await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'trakt','Social account generation fixture','https://fixture.invalid')`;
 await db`insert into provider_connections(id,user_id,instance_id,status) values(${connection},${ids[2]},${instance},'connected')`;
 try{
  await expect(reconcileProviderValue(ids[2],connection,work,'history',{value:true},{accountGeneration:crypto.randomUUID(),apply:()=>{throw Error('A stale response reached tracking.');}})).rejects.toThrow('connected account changed');
  expect(await db`select id from sync_values where connection_id=${connection}`).toHaveLength(0);
 }finally{await db`delete from provider_instances where id=${instance}`;}
});
run('collecting a parent carries its visible relationship to child indicators',async()=>{
 const db=getSql(),parent=crypto.randomUUID();
 await db`insert into works(id,category,kind) values(${parent},'screen','collection')`;
 await db`insert into media(id,kind,title) values(${parent},'collection','Social parent fixture')`;
 await db`insert into media_relationships(parent_id,child_id,kind) values(${parent},${work},'contains')`;
 try{
  await track(ids[2],{mediaId:parent,action:'collect',value:true});
  const request=await requestFriend(ids[1],{username:prefix+'-2'});await changeFriend(ids[2],request.id,{action:'accept'});
  expect((await workSocial(ids[1],[work]))[work].friends.some(f=>f.userId===ids[2])).toBe(true);
 }finally{await db`delete from media where id=${parent}`;await db`delete from works where id=${parent}`;}
});
run('private profile wins and friend removal revokes derived access',async()=>{
 await getSql()`update users set settings=${{social:{audience:'private',sections:{activity:'public'}}}}::jsonb where id=${ids[0]}`;
 expect(await canView(ids[0],ids[1],'activity')).toBe(false);expect(await canView(ids[0],ids[0],'activity')).toBe(true);
 await getSql()`update users set settings=${{social:{audience:'friends',sections:{activity:'public'}}}}::jsonb where id=${ids[0]}`;
 expect(await canView(ids[0],null,'activity')).toBe(true);expect(await canView(ids[0],null,'ratings')).toBe(false);
 await changeFriend(ids[1],friendId,{action:'remove'});expect(await canView(ids[0],ids[1],'ratings')).toBe(false);
 await expect(recommend(ids[1],{recipientId:ids[0],workId:work})).rejects.toThrow();
});

run('Next recommendations survive notification dismissal and obey recipient, kind, availability and response filters',async()=>{
 const db=getSql();const rec=await recommend(ids[1],{recipientId:ids[2],workId:work});
 await db`delete from notifications where user_id=${ids[2]} and source_key=${'recommendation:'+rec.id}`;
 const result=await progressData(ids[2],{view:'recommendations'});
 expect(result.total).toBe(1);expect(result.items[0].id).toBe(work);
 expect(result.items[0].captionSubtitle).toBe(`Recommended by ${prefix}-1`);
 expect(result.items[0].recommendationIds).toEqual([rec.id]);
 expect((await progressData(ids[1],{view:'recommendations'})).items.some(item=>item.recommendationIds?.includes(rec.id))).toBe(false);
 expect((await progressData(ids[2],{view:'recommendations',kind:'show'})).total).toBe(0);
 expect((await progressData(ids[2],{view:'recommendations',scope:'available'})).total).toBe(0);
 await expect(progressData(ids[2],{view:'recommendations'},ids[1])).rejects.toThrow('private');
 await respondRecommendation(ids[2],rec.id,{action:'dismiss'});
 expect((await progressData(ids[2],{view:'recommendations'})).total).toBe(0);
});
