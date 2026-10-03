import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';

// Historical full-result and latency verification. The provided URL is used
// only to create/drop a new disposable database, never as the workload target.
// Run with TEST_DATABASE_URL set, optionally passing an output JSON path.
async function verifyFixture(){
if(!/^\/coast_performance_verify_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL??'http://invalid').pathname))throw new Error('The worker requires its generated disposable database.');
const {getSql,closeDb}=await import(new URL('../src/lib/server/db',import.meta.url).href);
const before=await import(process.env.COAST_PERFORMANCE_BASELINE!);
const after=await import(new URL('../src/lib/collection/query.server',import.meta.url).href);
const {contentRevision}=await import(new URL('../src/lib/server/content-revision.server',import.meta.url).href);
const {collectionFreshnessSql}=await import(new URL('../src/lib/collection/freshness.server',import.meta.url).href);
const {startBenchmark,executeBenchmark,listBenchmarks}=await import(new URL('../src/lib/benchmarks/service.server',import.meta.url).href);
const {claimNextAction}=await import(new URL('../src/lib/server/queue',import.meta.url).href);
const db=getSql(),owner='10000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000002';
const median=(rows:number[])=>[...rows].sort((a,b)=>a-b)[Math.floor(rows.length/2)];
const normalize=(rows:any[])=>JSON.stringify(rows.map(r=>({...r,reasons:r.reasons?.slice().sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>a.id.localeCompare(b.id)));
const results:any={dataset:{shows:400,episodes:20000,movies:2000,works:22400,tracking:12400},queries:[],equivalence:[],contention:[],revisions:{}};
try{
  await db`insert into users(id,username) values('10000000-0000-4000-8000-000000000001','perf-owner'),('10000000-0000-4000-8000-000000000002','perf-viewer')`;
  await db`insert into provider_instances(id,provider,name,base_url) values('20000000-0000-4000-8000-000000000001','jellyfin','Fixture','https://fixture.invalid')`;
  await db`insert into provider_connections(id,user_id,instance_id,external_user_id) values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture')`;
  await db`insert into sync_checkpoints(connection_id,kind,completed_at) values('30000000-0000-4000-8000-000000000001','jellyfin-user',now())`;
  const showCount=400,episodesPerShow=50,movieCount=2000;
  await db.unsafe(`insert into media(id,kind,title,release_date) select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'show','Fixture show '||n,'2020-01-01' from generate_series(1,${showCount}) n`);
  await db`insert into shows(media_id) select id from media where kind='show'`;
  await db.unsafe(`insert into media(id,kind,title,release_date,runtime_minutes) select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'episode','Fixture episode '||n,'2020-01-01',45 from generate_series(1,${showCount*episodesPerShow}) n`);
  await db.unsafe(`insert into episodes(media_id,show_id,season_number,episode_number) select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('40000000-0000-4000-8000-'||lpad((1+(n-1)/${episodesPerShow})::text,12,'0'))::uuid,1,1+(n-1)%${episodesPerShow} from generate_series(1,${showCount*episodesPerShow}) n`);
  await db.unsafe(`insert into media(id,kind,title,release_date,runtime_minutes) select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'movie','Fixture movie '||n,'2020-01-01',120 from generate_series(1,${movieCount}) n`);
  await db`insert into tracking_state(user_id,media_id,collected,watchlist,watched,play_count) select '10000000-0000-4000-8000-000000000001',id,kind='movie',kind='show',kind='episode' and right(id::text,12)::bigint%50<25,case when kind='episode' and right(id::text,12)::bigint%50<25 then 1 else 0 end from media where kind='movie' or kind='show' or (kind='episode' and right(id::text,12)::bigint<=10000)`;
  await db`insert into provider_items(instance_id,media_id,external_id,kind,snapshot) select '20000000-0000-4000-8000-000000000001',id,id::text,kind,case when kind='show' then '{"membershipComplete":true,"expectedMembers":50}'::jsonb else '{}'::jsonb end from media`;
  await db`insert into availability(user_id,connection_id,provider_item_id,media_id,state) select '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',id,media_id,case when right(media_id::text,12)::bigint%5=0 then 'unavailable' else 'available' end from provider_items`;
  await db`analyze`;

 console.info('Seeded22400works/12400tracking');
 // Alternate the two implementations on the same warm fixture; retain every sample.
 for(let round=0;round<5;round++)for(const [name,module] of (round%2?[['after',after],['before',before]]:[['before',before],['after',after]]) as const){
  let t=performance.now();const statement=sql`${module.collectionCTE(owner,owner,'all','personal','screen')} select count(*)::int as count from collection`;
  const assessed=await module.collectionRead(statement);results.queries.push({name,round,part:'assessment',ms:performance.now()-t,count:assessed[0].count});
  t=performance.now();const page=await module.collectionData(owner,{category:'screen',level:'root'});results.queries.push({name,round,part:'page',ms:performance.now()-t,total:page.total,items:page.items.length});
  console.info(name,round,results.queries.slice(-2).map((r:any)=>[r.part,Math.round(r.ms),r.count??r.total]));
 }
 for(const [name,module] of [['before',before],['after',after]] as const){
  const compiled=new PgDialect().sqlToQuery(sql`${module.collectionCTE(owner,owner,'all','personal','screen')} select count(*)::int from collection`);
  const plan=await db.begin(async tx=>{await tx`set local jit=off`;await tx`set local recursive_worktable_factor=0.01`;return tx.unsafe('explain(analyze,buffers,format json) '+compiled.sql,compiled.params);});
  results[name+'Plan']=plan;
 }
 for(const scenario of ['self','public','hidden-activity','dropped-direct-and-parent','disabled']){
  const settings=scenario==='hidden-activity'?{social:{audience:'public',sections:{activity:'private',progress:'private'}}}:{social:{audience:'public'}};
  await db`update users set settings=${settings}::jsonb,disabled=${scenario==='disabled'} where id=${owner}`;
  await db`update tracking_state set dropped=false where user_id=${owner}`;
  if(scenario==='dropped-direct-and-parent')await db`update tracking_state set dropped=true where user_id=${owner} and media_id in ('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001')`;
  const target=scenario==='self'?owner:viewer;
  const statement=(module:any)=>sql`${module.collectionCTE(owner,target,'all','personal','screen')} select * from collection order by id`;
  const baseline=normalize(Array.from(await before.collectionRead(statement(before)))), changed=normalize(Array.from(await after.collectionRead(statement(after))));
  if(baseline!==changed)throw new Error('Full equivalence failed:'+scenario);
  results.equivalence.push({scenario,equal:true,rows:JSON.parse(changed).length,bytes:changed.length});
  console.info('Equivalent',scenario,results.equivalence.at(-1).rows);
 }
 await db`update users set settings='{}'::jsonb,disabled=false where id=${owner}`;await db`update tracking_state set dropped=false where user_id=${owner}`;
 for(const [name,module] of [['before',before],['after',after]] as const){
  const pings:number[]=[],pages:any[]=[],began=performance.now();let done=false;
  const ping=(async()=>{while(!done){const t=performance.now();await db`select 1`;pings.push(performance.now()-t);await Bun.sleep(200);}})();
  try{await Promise.all(Array.from({length:4},async(_,index)=>{const t=performance.now(),page=await module.collectionData(owner,{category:'screen',level:'root',page:index+1});pages.push({page:index+1,ms:performance.now()-t,total:page.total,items:page.items.length});}));}finally{done=true;await ping;}
  results.contention.push({name,pages,pingSamples:pings,elapsedMs:performance.now()-began});console.info('Concurrent',name,pages.map(p=>Math.round(p.ms)));
 }
 const rev:number[]=[];for(let i=0;i<100;i++){const t=performance.now();await contentRevision(owner);rev.push(performance.now()-t);}
 results.revisions.read100={samples:rev,medianMs:median(rev),maxMs:Math.max(...rev)};
 results.revisions.freshnessIndex=[];
 for(let round=0;round<3;round++)for(const enabled of (round%2?[true,false]:[false,true])){
  if(!enabled)await db.unsafe('drop index if exists availability_expiry_idx');
  else await db.unsafe((await Bun.file(new URL('../drizzle/0040_collection_freshness.sql',import.meta.url)).text()).replace('CREATE INDEX','CREATE INDEX IF NOT EXISTS'));
  const times:number[]=[];
  for(let i=0;i<100;i++){const t=performance.now();await contentRevision(owner);times.push(performance.now()-t);}
  results.revisions.freshnessIndex.push({round,enabled,medianMs:median(times),maxMs:Math.max(...times)});
 }
 await db.unsafe((await Bun.file(new URL('../drizzle/0040_collection_freshness.sql',import.meta.url)).text()).replace('CREATE INDEX','CREATE INDEX IF NOT EXISTS'));
 results.revisions.freshnessPlan=await db`explain (analyze,buffers,format json) select ${collectionFreshnessSql(owner)}`;
 // Compare identical 10000-row updates with/without only our statement triggers.
 const writes:any[]=[];
 for(let round=0;round<5;round++)for(const enabled of (round%2?[true,false]:[false,true])){
  for(const name of ['insert','update','delete'])await db.unsafe(`alter table tracking_state ${enabled?'enable':'disable'} trigger tracking_state_content_${name}`);
  const t=performance.now();await db`update tracking_state set position_seconds=${round+(enabled?.5:.25)} where user_id=${owner}`;writes.push({round,enabled,rows:12400,ms:performance.now()-t});
 }
 for(const name of ['insert','update','delete'])await db.unsafe(`alter table tracking_state enable trigger tracking_state_content_${name}`);
 results.revisions.bulkWrites=writes;
 // Concurrent independent user imports, with shared metadata and reversed statement order.
 await db`insert into tracking_state(user_id,media_id) select ${viewer},id from media where kind='movie'`;
 const concurrent:any[]=[];
 for(let round=0;round<5;round++){
  const t=performance.now();const outcomes=await Promise.allSettled([
   db.begin(async tx=>{await tx`update media set title=title||'x' where kind='movie' and right(id::text,12)::bigint%2=0`;await tx`update tracking_state set position_seconds=${round+1} where user_id=${owner} and media_id in(select id from media where kind='movie' and right(id::text,12)::bigint%2=0)`;}),
   db.begin(async tx=>{await tx`update tracking_state set position_seconds=${round+1} where user_id=${viewer} and media_id in(select id from media where kind='movie' and right(id::text,12)::bigint%2=1)`;await tx`update media set title=title||'y' where kind='movie' and right(id::text,12)::bigint%2=1`;})
  ]);
  if(outcomes.some(o=>o.status==='rejected'))throw new Error('Concurrent import failed');
  concurrent.push({round,ms:performance.now()-t});
 }
 results.revisions.concurrentImports=concurrent;
 results.revisions.pendingRows=(await db`select count(*)::int as total from content_revision_changes`)[0].total;
 await writeFile(process.env.COAST_PERFORMANCE_RESULT!,JSON.stringify(results,null,2));
 // Actual durable benchmark against the representative catalogue, not a stub query.
 await db`update users set role='admin' where id=${owner}`;
 const [actor]=await db`select * from users where id=${owner}`;
 for(let round=0;round<2;round++){
  const item=await startBenchmark(actor);const action=await claimNextAction();if(action?.id!==item.run.actionId)throw new Error('Wrong benchmark action');
  await executeBenchmark(action!);await db`update outbox_actions set state='succeeded' where id=${action!.id}`;
 }
 results.benchmarks=await listBenchmarks(actor);
 results.baselineRef=process.env.COAST_PERFORMANCE_BASELINE_REF;
 await writeFile(process.env.COAST_PERFORMANCE_RESULT!,JSON.stringify(results,null,2));
 console.info('Completed representative verification',{revisionReadMedianMs:results.revisions.read100.medianMs,bulkWrites:writes.map(w=>[w.enabled,Math.round(w.ms)]),concurrent:concurrent.map(c=>Math.round(c.ms)),benchmarks:results.benchmarks.runs.map((r:any)=>r.state)});
}finally{await closeDb();}

}
if(process.argv[2]==='--fixture')await verifyFixture();
else {
 const target=process.env.TEST_DATABASE_URL;
 if(!target)throw new Error('Set TEST_DATABASE_URL to an account allowed to create disposable databases.');
 const ref=process.env.COAST_PERFORMANCE_BASELINE_REF??'c771fb92f46ccbc173994b39b6885a96bf6a6dec';
 if(!/^[a-f0-9]{7,40}$/.test(ref))throw new Error('Use an immutable baseline Git commit.');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const output=process.argv[2]??join(tmpdir(),'coast-performance-verification.json');
 const data=await mkdtemp(join(tmpdir(),'coast-performance-verification-'));
 const modules=await mkdtemp(join(root,'.data-performance-verification-'));
 const name='coast_performance_verify_'+crypto.randomUUID().replaceAll('-','');
 const admin=new Bun.SQL(target,{max:1});let created=false;
 try {
  const git=Bun.spawn(['git','show',ref+':src/lib/collection/query.server.ts'],{cwd:root,stdout:'pipe',stderr:'pipe'});
  const baseline=await new Response(git.stdout).text();
  if(await git.exited)throw new Error('The immutable baseline source was not found.');
  const baselinePath=join(modules,'collection-baseline.ts');await writeFile(baselinePath,baseline);
  await admin.unsafe('create database '+name);created=true;
  const url=new URL(target);url.pathname='/'+name;
  const env={...process.env,DATABASE_URL:url.toString(),COAST_DATA_DIR:data,
   COAST_PERFORMANCE_BASELINE:baselinePath,COAST_PERFORMANCE_BASELINE_REF:ref,COAST_PERFORMANCE_RESULT:output};
  let status=await Bun.spawn([process.execPath,'scripts/migrate.ts'],{cwd:root,env,stdout:'inherit',stderr:'inherit'}).exited;
  if(!status)status=await Bun.spawn([process.execPath,fileURLToPath(import.meta.url),'--fixture'],{cwd:root,env,stdout:'inherit',stderr:'inherit'}).exited;
  process.exitCode=status;
 } finally {
  try{if(created)await admin.unsafe('drop database '+name+' with(force)');}
  finally{await admin.close();await rm(data,{recursive:true,force:true});await rm(modules,{recursive:true,force:true});}
 }
}
