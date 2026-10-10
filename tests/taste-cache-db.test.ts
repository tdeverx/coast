import {beforeAll,afterAll,test,expect} from 'bun:test';
import {sql as query} from 'drizzle-orm';
import {getSql,getDb} from '../src/lib/server/db';
import {refreshTasteCaches,runTasteRefresh,scheduleTasteRefresh,updateTasteSchedule,tasteJob,tasteRevisionSql} from '../src/lib/social/taste-cache.server';
import {recommendationRows} from '../src/lib/recommendations/query.server';
import {importIgdbMetadata,gameDetails} from '../src/lib/core/games/service.server';
import {mapIgdbGame} from '../src/lib/providers/igdb/adapter.server';
import {track} from '../src/lib/core/tracking/service.server';
import {workTasteFeatures} from '../src/lib/social/work-features.server';
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
 const profiles=await sql`select * from user_taste_profiles where user_id=${user}`;expect(profiles).toHaveLength(4);
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
 const parentId=801991,childId=801992;
 const child=await importIgdbMetadata(mapIgdbGame({id:childId,name:'Fixture Playtest',parent_game:{id:parentId,name:'Fixture main game',cover:{image_id:'parent_cover'},genres:[{name:'Adventure'}]},external_games:[{uid:'901992',url:'https://store.steampowered.com/app/901992/'}]}));
 const sql=getSql();try{
  await track(user,{mediaId:child.id,action:'collect',value:true});
  const presentation=await gameDetails(user,child.id);expect(presentation.title).toBe('Fixture Playtest');expect(presentation.posterPath).toContain('parent_cover');
  const [variant]=await sql`select parent_id from game_variants where game_id=${child.id}`;
  expect((await sql`select * from tracking_state where user_id=${user} and media_id=${variant.parent_id}`)).toHaveLength(0);
  expect((await sql`select game_id from game_external_ids where provider='steam' and external_id='901992'`)[0].game_id).toBe(child.id);
  expect((await workTasteFeatures([child.id])).get(child.id)?.genres?.[0].name).toBe('Adventure');
 }finally{await sql`delete from games where id in (select game_id from game_external_ids where provider='igdb' and external_id in ('801991','801992'))`;}
});
