import {beforeAll,afterAll,test,expect,spyOn} from 'bun:test';
import {sql as query} from 'drizzle-orm';
import {getSql,getDb} from '../src/lib/server/db';
import {personalTaste,personalTasteAffinities,refreshTasteCaches,runTasteRefresh,scheduleTasteRefresh,updateTasteSchedule,tasteJob,tasteRevisionSql,titleTaste,titleTastes,maxTasteBatchSize} from '../src/lib/social/taste-cache.server';
import {handleProfile} from '../src/lib/server/api/profile.server';
import {handleAdmin} from '../src/lib/server/api/admin.server';
import type {ApiContext} from '../src/lib/server/api/context.server';
import {recommendationRows} from '../src/lib/recommendations/query.server';
import {importIgdbMetadata,gameDetails} from '../src/lib/core/games/service.server';
import {TmdbAdapter} from '../src/lib/providers/tmdb/adapter.server';
import {ingestMetadata} from '../src/lib/catalogue/service.server';
import {mapIgdbGame} from '../src/lib/providers/igdb/adapter.server';
import {track} from '../src/lib/core/tracking/service.server';
import {workTasteFeatures} from '../src/lib/social/work-features.server';
import * as featureReads from '../src/lib/social/work-features.server';
import * as permissions from '../src/lib/server/features';
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
 expect(await titleTaste(user,ids[2])).toMatchObject({score:score.score,confidence:score.confidence});
 expect(await titleTaste(other,ids[2])).toBeNull();
 const [none]=await sql`select count(*)::int as count from user_taste_scores where user_id=${other}`;expect(none.count).toBe(0);
 const result=await recommendationRows(user,'recommendations',new URL('http://test/?category=screen'));expect(result.items.some(item=>item.id===ids[2])).toBe(true);
 // Shared enrichment queues a later refresh without invalidating private scores mid-backfill.
 await sql`update work_features set updated_at=now() where work_id=${ids[2]}`;
 const [enriched]=await getDb().execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user}::uuid`);expect(enriched.revision).toBe(score.revision);
  await track(user,{mediaId:ids[0],action:'drop',value:true});
 const [current]=await getDb().execute<{revision:string}>(query`select ${tasteRevisionSql} as revision from users u where u.id=${user}::uuid`);expect(score.revision).not.toBe(current.revision);
 await refreshTasteCaches();const [updated]=await sql`select revision from user_taste_profiles where user_id=${user} and medium='movie'`;expect(updated.revision).toBe(current.revision);
 // Hiding a favourite from progress does not undo the user's explicit preference.
 const [rebuilt]=await sql`select score,revision from user_taste_scores where user_id=${user} and work_id=${ids[2]}`;
 expect(rebuilt.revision).toBe(current.revision);expect(rebuilt.score).toBeGreaterThan(50);
 expect(await sql`select 1 from user_taste_scores where user_id=${user} and revision=${score.revision}`).toHaveLength(0);
});
run('taste metadata retains complementary sources and resolves genres with the configured priority',async()=>{
 const sql=getSql(),id=ids[3];
 await sql`insert into work_features(work_id,provider,features) values(${id},'trakt','{"tags":[{"id":"trakt:quest","name":"Quest"}]}')`;
 await sql`insert into metadata_snapshots(media_id,provider,genres,raw) values
  (${id},'jellyfin',array['Mystery'],'{}'),
  (${id},'tmdb',array['Science Fiction'],'{"facts":{"originalLanguage":"en","studios":[{"name":"Coast Studio"}]}}')`;
 const local=(await workTasteFeatures([id],'local-preferred')).get(id);
 expect(local?.genres?.map(value=>value.name)).toEqual(['Mystery']);
 expect(local?.tags?.map(value=>value.name)).toEqual(expect.arrayContaining(['Space exploration','Quest']));
 expect(local?.languages?.map(value=>value.name)).toEqual(['English']);
 expect(local?.studios?.map(value=>value.name)).toEqual(['Coast Studio']);
 expect((await workTasteFeatures([id],'tmdb-only')).get(id)?.genres?.map(value=>value.name)).toEqual(['Science Fiction']);
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

run('lifetime profiles include retained history and all affinities across pages',async()=>{
 const db=getSql(),viewer=crypto.randomUUID(),movies=Array.from({length:625},()=>crypto.randomUUID());
 const keys=db.array(movies,'UUID');
 await db`insert into users(id,username) values(${viewer},${'taste-lifetime-'+viewer})`;
 try{
  await db`insert into media(id,kind,title,genres)
    select id,'movie','Lifetime movie '||n,array['Drama'] from unnest(${keys}::uuid[]) with ordinality as item(id,n)`;
  await db`insert into work_features(work_id,provider,features)
    select id,'tmdb',jsonb_build_object('tags',jsonb_build_array(jsonb_build_object('id','tag-'||n,'name','Tag '||n)))
    from unnest(${keys}::uuid[]) with ordinality as item(id,n)`;
  await db`insert into tracking_events(user_id,media_id,action,applied,occurred_at)
    select ${viewer},id,'watch',true,now()-make_interval(days=>n::int)
    from unnest(${keys}::uuid[]) with ordinality as item(id,n)`;
  await db`insert into tracking_events(user_id,media_id,action,applied)
    values(${viewer},${movies.at(-1)},'watch',true)`;
  await db`insert into ratings(user_id,media_id,value) values
    (${viewer},${movies[0]},5),(${viewer},${movies[1]},3.5),(${viewer},${movies.at(-1)},2)`;

  await refreshTasteCaches();

  const movie=(await personalTaste(viewer)).find(profile=>profile.medium==='movie');
  expect(movie).toMatchObject({works:625,worksWithSignals:625,ratings:3,medianRating:3.5,explicitWorks:3,inferredWorks:622,
    consumedWorks:625,repeatedWorks:0,
    signals:{tags:{count:625}}});
  const [saved]=await db`select profile from user_taste_profiles where user_id=${viewer} and medium='movie'`;
  const [,name,affinity,support,,negative,explicit]=saved.profile.dimensions.tags.find((entry:unknown[])=>entry[0]==='tag-625');
  expect(name).toBe('Tag 625');expect(support).toBe(1);expect(explicit).toBe(1);
  expect(affinity).toBeLessThan(0);expect(negative).toBeGreaterThan(0);
  expect(await personalTasteAffinities(viewer,'movie','tags',25)).toMatchObject({pages:25,items:Array(25).fill(expect.objectContaining({samples:1}))});
  expect(await personalTasteAffinities(viewer,'movie','tags',26)).toEqual({items:[],pages:25});
  expect(await personalTasteAffinities(other,'movie','tags',1)).toEqual({items:[],pages:1});

  await db`update user_taste_profiles set updated_at=now()-interval '6 days' where user_id=${viewer}`;
  expect((await getDb().transaction(tx=>scheduleTasteRefresh(tx))).queued).toBe(0);
  await db`update user_taste_profiles set updated_at=now()-interval '8 days' where user_id=${viewer} and medium='movie'`;
  expect((await getDb().transaction(tx=>scheduleTasteRefresh(tx))).queued).toBe(1);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from media where id=any(${keys}::uuid[])`;
 }
});

run('private profile and match reads withdraw old source permissions immediately',async()=>{
 const db=getSql(),owner=crypto.randomUUID();
 await db`insert into users(id,username) values(${owner},${'taste-policy-'+owner})`;
 try{
  for(const id of ids.slice(0,2))await track(owner,{mediaId:id,action:'favourite',value:true});
  await refreshTasteCaches();
  const saved=await titleTaste(owner,ids[2]);
  expect(saved?.score).toBeGreaterThan(50);
  // A warmed result and the on-demand scorer use the same reference and explanation.
  const spy=spyOn(featureReads,'workTasteFeatures');
  try{
   expect(await titleTaste(owner,ids[2])).toEqual(saved);
   expect(spy).not.toHaveBeenCalled();
   const adminRequest=new Request('http://coast.test/api/v1/admin/taste-score?'+new URLSearchParams({workId:ids[2],username:'another-viewer'}));
   const adminContext={uid:owner,subjectId:other,method:'GET',request:adminRequest,url:new URL(adminRequest.url),path:['admin','taste-score'],
    user:{id:owner,username:'tester',email:null,settings:{},role:'admin'}} as ApiContext;
   await expect(handleAdmin({...adminContext,user:{...adminContext.user,role:'user'}})).rejects.toMatchObject({status:403});
   // The testing action always evaluates current metadata. It must not publish a new result.
   await db`update user_taste_scores set breakdown=jsonb_set(breakdown,'{score}','7') where user_id=${owner} and work_id=${ids[2]}`;
   const adminResponse=await handleAdmin(adminContext);
   expect(adminResponse!.headers.get('cache-control')).toContain('no-store');
   const {match:{breakdown,...result}}=await adminResponse!.json();
   expect(result).toEqual(saved);
   expect(breakdown.signals.some((signal:{dimension:string;matched:number})=>signal.dimension==='cast'&&signal.matched>0)).toBe(true);
   expect(breakdown.calculation.baseScore+breakdown.calculation.ratingAdjustment).toBe(saved!.score!);
   expect(spy).toHaveBeenCalledTimes(1);
   expect((await titleTaste(owner,ids[2]))?.score).toBe(7);
   const unavailable=new URL(adminRequest.url);
   unavailable.searchParams.set('workId',crypto.randomUUID());
   expect(await (await handleAdmin({...adminContext,url:unavailable}))!.json()).toEqual({match:null});
   spy.mockClear();
   await db`delete from user_taste_scores where user_id=${owner} and work_id=${ids[2]}`;
   expect(await titleTaste(owner,ids[2])).toEqual(saved);
   expect(spy).toHaveBeenCalledTimes(1);
   spy.mockClear();
   const missing=crypto.randomUUID(),lookups=await titleTastes(owner,[ids[0],ids[1],ids[2].toUpperCase(),ids[0],missing]);
   expect(lookups.size).toBe(3);
   expect(lookups.get(ids[2].toUpperCase())??null).toEqual(saved);
   expect(lookups.has(missing)).toBe(false);
   expect(spy.mock.calls).toHaveLength(1);
   expect(new Set(spy.mock.calls[0][0])).toEqual(new Set(ids.slice(0,3)));
   await expect(titleTastes(owner,Array(maxTasteBatchSize+1).fill(ids[0]))).rejects.toMatchObject({status:400});
   const request=new Request('http://coast.test/api/v1/profile/taste-match?'+new URLSearchParams({workId:ids[2]}));
   const context={uid:owner,subjectId:other,request,url:new URL(request.url),method:'GET',path:['profile','taste-match']} as ApiContext;
   const response=await handleProfile(context);
   expect(await response!.json()).toEqual({match:saved});
   const abort=new AbortController();abort.abort();
   await expect(handleProfile({...context,request:new Request(request,{signal:abort.signal})})).rejects.toMatchObject({name:'AbortError'});
  }finally{spy.mockRestore();}
  await db`update users set access_defaults='{"social":false}' where id=${owner}`;
  expect(await personalTaste(owner)).toEqual([]);
  expect(await personalTasteAffinities(owner,'movie','genres',1)).toEqual({items:[],pages:1});
  expect(await titleTaste(owner,ids[2])).toBeNull();
  expect((await titleTastes(owner,ids)).size).toBe(0);
  await refreshTasteCaches();
  expect((await personalTaste(owner)).find(profile=>profile.medium==='movie')?.works).toBe(2);
 }finally{await db`delete from users where id=${owner}`;}
});

run('a withdrawn medium or personalisation permission is checked again when private taste is read',async()=>{
 const db=getSql(),owner=crypto.randomUUID();
 await db`insert into users(id,username) values(${owner},${'taste-withdraw-'+owner})`;
 try{
  for(const id of ids.slice(0,2))await track(owner,{mediaId:id,action:'favourite',value:true});
  await refreshTasteCaches();
  const admit=permissions.requireFeature;
  for(const feature of ['screen','personalisation'] as const){
   await db`update users set settings='{}' where id=${owner}`;
   const gate=spyOn(permissions,'requireFeature').mockImplementationOnce(async(...args)=>{
    const config=await admit(...args);
    await db`update users set settings=${{features:{[feature]:false}}}::jsonb where id=${owner}`;
    return config;
   });
   try{
    if(feature==='screen')expect((await personalTaste(owner)).map(entry=>entry.medium)).not.toContain('movie');
    else expect(await personalTasteAffinities(owner,'movie','cast',1)).toEqual({items:[],pages:1});
    expect(gate).toHaveBeenCalledTimes(1);
   }finally{gate.mockRestore();}
  }
 }finally{await db`delete from users where id=${owner}`;}
});

run('one observed work is retained in the summary without preparing or hydrating unscoreable targets',async()=>{
 const db=getSql(),owner=crypto.randomUUID();
 await db`insert into users(id,username) values(${owner},${'taste-single-'+owner})`;
 try{
  await track(owner,{mediaId:ids[0],action:'favourite',value:true});
  await refreshTasteCaches();
  expect((await personalTaste(owner)).find(entry=>entry.medium==='movie')?.works).toBe(1);
  expect(await db`select 1 from user_taste_scores where user_id=${owner}`).toHaveLength(0);
  const read=spyOn(featureReads,'workTasteFeatures');
  try{
   const match=await titleTaste(owner,ids[2]);
   expect(match).toEqual({score:null,confidence:0,dimensions:{},reasons:[],matches:0});
   expect(read).not.toHaveBeenCalled();
  }finally{read.mockRestore();}
 }finally{await db`delete from users where id=${owner}`;}
});

run('a supported rating comparison survives publication and agrees with on-demand scoring',async()=>{
 const db=getSql(),owner=crypto.randomUUID(),works=Array.from({length:62},()=>crypto.randomUUID());
 const workIds=db.array(works,'UUID');
 await db`insert into users(id,username) values(${owner},${'taste-trained-'+owner})`;
 try{
  await db`insert into media(id,kind,title,genres)
   select id,'movie','Rating fixture '||ord,array[case when ord%4 in (0,1) then 'Space' else 'Magic' end]
   from unnest(${workIds}::uuid[]) with ordinality as f(id,ord)`;
  await db`insert into work_features(work_id,provider,features)
   select id,'tmdb',jsonb_build_object('tags',jsonb_build_array(jsonb_build_object('id',subject,'name',subject)))
   from unnest(${workIds}::uuid[]) with ordinality as f(id,ord)
   cross join lateral (select case when ord%4 in (1,2) then 'Exploration' else 'Combat' end as subject) s`;
  await db`insert into ratings(user_id,media_id,value)
   select ${owner},id,case when ord%4 in (1,3) then 5 else 2 end
   from unnest(${workIds}::uuid[]) with ordinality as f(id,ord) where ord<=60`;
  await refreshTasteCaches();
  const [profile]=await db`select profile,scoring from user_taste_profiles where user_id=${owner} and medium='movie'`;
  expect(profile.profile.ratingWeights).toBeUndefined();
  expect(Object.keys(profile.scoring.ratingWeights).length).toBeGreaterThan(0);
  const [cached]=await db`select breakdown from user_taste_scores where user_id=${owner} and work_id=${works[60]}`;
  const warm=await titleTaste(owner,works[60]);
  expect(warm?.ratingAdjustment).toBeGreaterThan(0);
  expect(warm).toEqual(cached.breakdown);
  const inspected=await titleTaste(owner,works[60],'recalculate');
  expect(inspected).toMatchObject(warm!);
  expect(inspected?.breakdown?.calculation?.ratingTerms.length).toBeGreaterThan(0);
  expect((await titleTaste(owner,works[61]))?.ratingAdjustment).toBeLessThan(0);
 }finally{
  await db`delete from users where id=${owner}`;
  await db`delete from media where id=any(${workIds}::uuid[])`;
 }
});

run('linked tracks use the album reference on warm and on-demand item reads',async()=>{
 const db=getSql(),owner=crypto.randomUUID(),albums=Array.from({length:7},()=>crypto.randomUUID()),trackId=crypto.randomUUID(),artistId=crypto.randomUUID();
 const workIds=db.array([...albums,trackId],'UUID');
 await db`insert into users(id,username) values(${owner},${'taste-album-'+owner})`;
 try{
  await db`insert into works(id,category,kind)
   select id,'music',case when id=${trackId} then 'track' else 'album' end from unnest(${workIds}::uuid[]) items(id)`;
  await db`insert into music_works(id,kind,title,artist_names)
   select id,kind,'Album fixture',case when kind='album' then array['Repeated artist'] else array['Different track credit'] end
   from works where id=any(${workIds}::uuid[])`;
  await db`insert into works(id,category,kind) values(${artistId},'music','artist')`;
  await db`insert into music_works(id,kind,title) values(${artistId},'artist','Repeated artist')`;
  await db`insert into music_credits(work_id,artist_id,role)
   select id,${artistId},'album-artist' from unnest(${db.array(albums,'UUID')}::uuid[]) as a(id)`;
  await db`insert into media_relationships(parent_id,child_id,kind,position) values(${albums[6]},${trackId},'contains',1)`;
  for(const id of albums.slice(0,6))await track(owner,{mediaId:id,action:'favourite',value:true});
  await refreshTasteCaches();
  const expected=await titleTaste(owner,albums[6]);
  expect(expected?.score).toBeGreaterThan(50);
  const [revision]=await db`select revision from user_taste_profiles where user_id=${owner} and medium='music'`;
  await db`insert into user_taste_scores(user_id,work_id,score,confidence,revision,breakdown)
   values(${owner},${albums[6]},${expected!.score},${expected!.confidence},${revision.revision},${expected}::jsonb)
   on conflict(user_id,work_id) do nothing`;
  expect(await titleTaste(owner,trackId)).toEqual(expected);
  await db`delete from user_taste_scores where user_id=${owner}`;
  expect(await titleTaste(owner,trackId)).toEqual(expected);
  const guest=crypto.randomUUID();
  await db`insert into works(id,category,kind) values(${guest},'music','artist')`;
  try{
   await db`insert into music_works(id,kind,title) values(${guest},'artist','Unfamiliar track artist')`;
   await db`insert into music_credits(work_id,artist_id,role) values(${trackId},${guest},'artist')`;
   const read=spyOn(featureReads,'workTasteFeatures');
   try{
    const batch=await titleTastes(owner,[trackId,albums[6]]);
    expect(read.mock.calls).toHaveLength(1);
    expect(new Set(read.mock.calls[0][0])).toEqual(new Set([trackId,albums[6]]));
    expect(batch.get(trackId)?.score).toBeNull();
    expect(batch.get(albums[6])??null).toEqual(expected);
   }finally{read.mockRestore();}
  }finally{await db`delete from works where id=${guest}`;}
 }finally{
  await db`delete from users where id=${owner}`;
  await db`delete from works where id=any(${workIds}::uuid[]) or id=${artistId}`;
 }
});

run('verified episode credits score the individual item while uncredited episodes reuse their show',async()=>{
 const db=getSql(),owner=crypto.randomUUID(),shows=Array.from({length:7},()=>crypto.randomUUID()),episodes=[crypto.randomUUID(),crypto.randomUUID()];
 const season=crypto.randomUUID(),target=shows[6],showIds=db.array(shows,'UUID');
 await db`insert into users(id,username) values(${owner},${'taste-episode-'+owner})`;
 try{
  await db`insert into media(id,kind,title) select id,'show','Show' from unnest(${showIds}::uuid[]) t(id)`;
  await db`insert into shows(media_id) select id from unnest(${showIds}::uuid[]) t(id)`;
  await db`insert into media(id,kind,title) values(${episodes[0]},'episode','Guest'),(${episodes[1]},'episode','Regular')`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${episodes[0]},${target},1,1),(${episodes[1]},${target},1,2)`;
  await db`insert into work_features(work_id,provider,features)
   select id,'tmdb','{"directors":[{"id":"tmdb:17","name":"Familiar director"}]}'::jsonb from unnest(${showIds}::uuid[]) t(id)`;
  const tmdb=new TmdbAdapter(async()=>({id:820011,name:'Guest',credits:{cast:[],crew:[{id:45,name:'Guest director',job:'Director'}]}}));
  await ingestMetadata(await tmdb.episode('820010',1,1),{mediaId:episodes[0],showId:target});
  await db`insert into media(id,kind,title) values(${season},'season','Guest season')`;
  await db`insert into seasons(media_id,show_id,season_number) values(${season},${target},1)`;
  await db`insert into metadata_snapshots(media_id,provider,raw) values
   (${season},'tmdb','{"facts":{"credits":[{"id":"45","name":"Guest director","role":"Director"}]}}')`;
  for(const id of shows.slice(0,6))await track(owner,{mediaId:id,action:'favourite',value:true});
  await refreshTasteCaches();
  const read=spyOn(featureReads,'workTasteFeatures');
  try{
   const matches=await titleTastes(owner,[target,...episodes,season]);
   expect(matches.get(season)?.score).toBeNull();
   expect(matches.get(target)?.score).toBeGreaterThan(50);
   expect(matches.get(episodes[1])).toEqual(matches.get(target));
   expect(matches.get(episodes[0])?.score).toBeNull();
   expect(read.mock.calls).toHaveLength(1);
   expect(new Set(read.mock.calls[0][0])).toEqual(new Set([target,episodes[0],season]));
  }finally{read.mockRestore();}
 }finally{
  await db`delete from users where id=${owner}`;
  await db`delete from media where id=any(${db.array([...shows,...episodes,season],'UUID')}::uuid[])`;
 }
});
