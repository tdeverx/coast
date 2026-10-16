import {beforeAll,afterAll,test,expect,spyOn} from 'bun:test';
import {sql as query} from 'drizzle-orm';
import {getSql,getDb} from '../src/lib/server/db';
import {refreshTasteCaches,runTasteRefresh,scheduleTasteRefresh,updateTasteSchedule,tasteJob,tasteRevisionSql} from '../src/lib/social/taste-cache.server';
import {recommendationRows} from '../src/lib/recommendations/query.server';
import {importIgdbMetadata,gameDetails} from '../src/lib/core/games/service.server';
import {mapIgdbGame} from '../src/lib/providers/igdb/adapter.server';
import {track} from '../src/lib/core/tracking/service.server';
import {workTasteFeatures} from '../src/lib/social/work-features.server';
import * as featureReads from '../src/lib/social/work-features.server';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const user=crypto.randomUUID(),other=crypto.randomUUID(),ids=Array.from({length:4},()=>crypto.randomUUID());
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const sql=getSql();for(const id of [user,other])await sql`insert into users(id,username) values(${id},${'taste-'+id})`;
 await sql`insert into system_settings(key,value) values('coast','{"experimentalGaming":true,"experimentalMusic":true}') on conflict(key) do update set value=excluded.value`;
 for(const id of ids){await sql`insert into media(id,kind,title,genres) values(${id},'movie',${'Taste '+id},array['Drama'])`;await sql`insert into work_features(work_id,provider,features) values(${id},'tmdb','{"cast":[{"id":"tmdb:actor","name":"Shared actor"}],"tags":[{"id":"tmdb:space","name":"Space exploration"}]}')`;}
});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const sql=getSql();await sql`delete from users where id=any(${sql.array([user,other],'UUID')}::uuid[])`;await sql`delete from media where id=any(${sql.array(ids,'UUID')}::uuid[])`;});
run('task computes private bounded scores and excludes stale cached rankings',async()=>{
 await track(user,{mediaId:ids[0],action:'favourite',value:true});await track(user,{mediaId:ids[1],action:'favourite',value:true});
 // Match creators/tags even when the candidate's genres do not overlap.
 await getSql()`update media set genres=array['Comedy'] where id=${ids[2]}`;
 await refreshTasteCaches();const sql=getSql();
 const profiles=await sql`select * from user_taste_profiles where user_id=${user}`;expect(profiles.map((profile:any)=>profile.medium).sort()).toEqual(['game','movie','music','show']);
 const [score]=await sql`select * from user_taste_scores where user_id=${user} and work_id=${ids[2]}`;expect(score.score).toBeGreaterThan(50);expect(score.breakdown.reasons.some((r:any)=>r.dimension==='cast')).toBe(true);
 const [none]=await sql`select count(*)::int as count from user_taste_scores where user_id=${other}`;expect(none.count).toBe(0);
 const result=await recommendationRows(user,'recommendations',new URL('http://test/?category=screen'));expect(result.items.some(item=>item.id===ids[2])).toBe(true);
 // Shared enrichment queues a later refresh without invalidating private scores mid-backfill.
 await sql`update work_features set updated_at=now() where work_id=${ids[2]}`;
 const [enriched]=await getDb().execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user}::uuid`);expect(enriched.revision).toBe(score.revision);
  await track(user,{mediaId:ids[0],action:'drop',value:true});
 const [current]=await getDb().execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user}::uuid`);expect(score.revision).not.toBe(current.revision);
 await refreshTasteCaches();const [updated]=await sql`select revision from user_taste_profiles where user_id=${user} and medium='movie'`;expect(updated.revision).toBe(current.revision);
 expect(await sql`select * from user_taste_scores where user_id=${user} and work_id=${ids[2]}`).toHaveLength(0);
});
run('pause, manual run and single-job admission use the existing outbox',async()=>{
 const sql=getSql();await sql`delete from outbox_actions where kind='taste.refresh'`;
 await updateTasteSchedule({enabled:false,intervalMinutes:60});expect((await tasteJob()).timing.nextAt).toBeNull();
 await track(user,{mediaId:ids[3],action:'watchlist',value:true});
 expect((await getDb().transaction(tx=>scheduleTasteRefresh(tx))).queued).toBe(0);
 const runs=await Promise.all([runTasteRefresh(),runTasteRefresh()]);expect(runs.reduce((n,r)=>n+r.queued,0)).toBe(1);
 expect((await sql`select * from outbox_actions where kind='taste.refresh' and state='pending'`)).toHaveLength(1);
 await sql`delete from outbox_actions where kind='taste.refresh'`;await updateTasteSchedule({enabled:true,intervalMinutes:60});
});
run('concurrent changes retry promptly and large backlogs continue in bounded batches',async()=>{
 const sql=getSql();
 for(const outcome of [{checked:4,refreshed:0,deferred:4},{checked:10,refreshed:10,deferred:0}]){
  await sql`delete from outbox_actions where kind='taste.refresh'`;
  await sql`insert into outbox_actions(user_id,kind,state,payload,updated_at) values(${user},'taste.refresh','succeeded',${JSON.stringify({_jobOutcome:outcome})}::text::jsonb,now()-interval '2 minutes')`;
  expect((await getDb().transaction(tx=>scheduleTasteRefresh(tx))).queued).toBe(1);
 }
 await sql`delete from outbox_actions where kind='taste.refresh'`;
});
run('verified game parent supplies presentation, never transfers ownership or identities',async()=>{
 const parentId=801991,childId=801992,ancestorId=801990;
 const parent=await importIgdbMetadata(mapIgdbGame({id:parentId,name:'Fixture main game',parent_game:{id:ancestorId,name:'Earlier verified parent'}}));
 const child=await importIgdbMetadata(mapIgdbGame({id:childId,name:'Fixture Playtest',parent_game:{id:parentId,name:'Fixture main game',cover:{image_id:'parent_cover'},genres:[{name:'Adventure'}]},external_games:[{uid:'901992',url:'https://store.steampowered.com/app/901992/'}]}));
 const sql=getSql();try{
  expect(await sql`select * from game_variants where game_id=${parent.id}`).toHaveLength(1);
  await track(user,{mediaId:child.id,action:'collect',value:true});
  const presentation=await gameDetails(user,child.id);expect(presentation.title).toBe('Fixture Playtest');expect(presentation.posterPath).toContain('parent_cover');
  const [variant]=await sql`select parent_id from game_variants where game_id=${child.id}`;
  expect((await sql`select * from tracking_state where user_id=${user} and media_id=${variant.parent_id}`)).toHaveLength(0);
  expect((await sql`select game_id from game_external_ids where provider='steam' and external_id='901992'`)[0].game_id).toBe(child.id);
  expect((await workTasteFeatures([child.id])).get(child.id)?.genres?.[0].name).toBe('Adventure');
  const refreshed=await importIgdbMetadata(mapIgdbGame({id:childId,name:'Fixture Playtest',genres:[{name:'Puzzle'}],external_games:[{uid:'901992',url:'https://store.steampowered.com/app/901992/'}]}));
  expect(refreshed.id).toBe(child.id);
  expect(await sql`select * from game_variants where game_id=${child.id}`).toHaveLength(0);
  expect((await gameDetails(user,child.id)).posterPath).toBeNull();
  expect((await workTasteFeatures([child.id])).get(child.id)?.genres?.[0].name).toBe('Puzzle');
 }finally{await sql`delete from games where id in (select game_id from game_external_ids where provider='igdb' and external_id in ('801990','801991','801992'))`;}
});

run('taste jobs freeze ten users, commit the cursor with publication and resume without repeating completed users',async()=>{
 const db=getSql(),extra=Array.from({length:12},()=>crypto.randomUUID()),late=crypto.randomUUID(),job=crypto.randomUUID();
 await db`delete from outbox_actions where kind='taste.refresh'`;
 for(const id of extra)await db`insert into users(id,username) values(${id},${'taste-census-'+id})`;
 await db`insert into outbox_actions(id,user_id,kind,state,attempts,payload) values(${job},${user},'taste.refresh','running',1,'{}')`;
 const execute=()=>jobExecution.run({id:job,attempts:1,purpose:'scheduled' as const,started:performance.now(),checkpoints:0},()=>refreshTasteCaches());
 try{
  await expect(execute()).rejects.toBeInstanceOf(JobYield);
  const [paused]=await db`select payload->'_checkpoint' as checkpoint from outbox_actions where id=${job}`;
  expect(paused.checkpoint.users).toHaveLength(10);expect(paused.checkpoint.next).toBe(5);expect(paused.checkpoint.checked).toBe(5);
  for(const id of paused.checkpoint.users.slice(0,5))expect(await db`select medium from user_taste_profiles where user_id=${id}`).toHaveLength(4);
  const completed=paused.checkpoint.users[0];
  await db`update user_taste_profiles set updated_at='2000-01-01' where user_id=${completed}`;
  await db`insert into users(id,username) values(${late},${'taste-late-'+late})`;
  expect(await execute()).toEqual({checked:10,refreshed:10,deferred:0});
  const [finished]=await db`select payload->'_checkpoint' as checkpoint from outbox_actions where id=${job}`;
  expect(finished.checkpoint.users).toEqual(paused.checkpoint.users);expect(finished.checkpoint.next).toBe(10);
  expect(await db`select * from user_taste_profiles where user_id=${late}`).toHaveLength(0);
  expect(await db`select * from user_taste_profiles where user_id=${completed} and updated_at='2000-01-01'`).toHaveLength(4);
  expect(await execute()).toEqual({checked:10,refreshed:10,deferred:0});
 }finally{
  await db`delete from outbox_actions where id=${job}`;
  await db`delete from users where id=any(${db.array([...extra,late],'UUID')}::uuid[])`;
 }
});
run('cancelled or replaced taste attempts cannot publish profiles or advance their durable cursor',async()=>{
 const db=getSql(),original=featureReads.workTasteFeatures;
 for(const replacement of ['cancelled','recovered'] as const){
  const job=crypto.randomUUID(),checkpoint={task:'taste-refresh',users:[user],next:0,checked:0,refreshed:0,deferred:0};
  await db`insert into outbox_actions(id,user_id,kind,state,attempts,payload) values(${job},${user},'taste.refresh','running',1,${{_checkpoint:checkpoint}}::jsonb)`;
  const before=await db`select medium,revision,profile,updated_at from user_taste_profiles where user_id=${user} order by medium`;
  const reads=spyOn(featureReads,'workTasteFeatures').mockImplementation(async ids=>{
   const result=await original(ids);
   if(replacement==='cancelled')await db`update outbox_actions set state='cancelled' where id=${job}`;
   else await db`update outbox_actions set attempts=2 where id=${job}`;
   return result;
  });
  try{
   await expect(jobExecution.run({id:job,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>refreshTasteCaches())).rejects.toBeInstanceOf(JobYield);
   expect(await db`select medium,revision,profile,updated_at from user_taste_profiles where user_id=${user} order by medium`).toEqual(before);
   const [saved]=await db`select payload->'_checkpoint' as checkpoint from outbox_actions where id=${job}`;
   expect(saved.checkpoint).toEqual(checkpoint);
  }finally{reads.mockRestore();await db`delete from outbox_actions where id=${job}`;}
 }
});
run('taste jobs defer concurrent personal edits once and commit the frozen cursor without replacing scores',async()=>{
 const db=getSql(),job=crypto.randomUUID(),original=featureReads.workTasteFeatures;
 const checkpoint={task:'taste-refresh',users:[user],next:0,checked:0,refreshed:0,deferred:0};
 await db`insert into outbox_actions(id,user_id,kind,state,attempts,payload) values(${job},${user},'taste.refresh','running',1,${{_checkpoint:checkpoint}}::jsonb)`;
 const before=await db`select medium,revision,profile,updated_at from user_taste_profiles where user_id=${user} order by medium`;
 let changed=false;
 const reads=spyOn(featureReads,'workTasteFeatures').mockImplementation(async workIds=>{
  const result=await original(workIds);
  if(!changed){changed=true;await db`update tracking_state set favourite=not favourite where user_id=${user} and media_id=${ids[0]}`;}
  return result;
 });
 try{
  const outcome=await jobExecution.run({id:job,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>refreshTasteCaches());
  expect(outcome).toEqual({checked:1,refreshed:0,deferred:1});
  const [saved]=await db`select payload->'_checkpoint' as checkpoint from outbox_actions where id=${job}`;
  expect(saved.checkpoint).toEqual({...checkpoint,next:1,checked:1,deferred:1});
  expect(await db`select medium,revision,profile,updated_at from user_taste_profiles where user_id=${user} order by medium`).toEqual(before);
 }finally{reads.mockRestore();await db`delete from outbox_actions where id=${job}`;}
});
