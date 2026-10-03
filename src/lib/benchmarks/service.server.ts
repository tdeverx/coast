import { cpus, totalmem, release } from 'node:os';
import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql as statement } from 'drizzle-orm';
import type { SQL } from 'bun';
import { getSql } from '$lib/server/db';
import { requireAdmin, type SessionUser } from '$lib/server/auth';
import { AppError } from '$lib/server/security/errors';
import { PermanentActionError, type OutboxAction } from '$lib/server/queue';
import { collectionCTE } from '$lib/collection/query.server';
import { collectionFreshnessSql } from '$lib/collection/freshness.server';
import { serverBuildIdentity } from '$lib/server/build-identity';
import { getConfig } from '$lib/server/config';
import { journalGroups, type JournalEntry } from '$lib/profile/journal';
import { visibleJournalEntries } from '$lib/ui/shelves/journal-visible';
import { benchmarkVersion, compareBenchmarks, summarizeSamples, type BenchmarkRun, type BenchmarkContext, type BenchmarkMeasurements } from './model';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
function mapRun(row: Record<string,any>): BenchmarkRun {
  return { id:row.id, actionId:row.action_id, userId:row.user_id, state:row.state,
    workloadVersion:row.workload_version, createdAt:iso(row.created_at)!, startedAt:iso(row.started_at),
    finishedAt:iso(row.finished_at), context:row.context, measurements:row.measurements,
    comparisonKey:row.comparison_key, errors:row.errors };
}
async function currentAdmin(database: SQL, actor: SessionUser | null) {
  const user=requireAdmin(actor);
  const [row]=await database`select id from users where id=${user.id} and role='admin' and not disabled`;
  if (!row) throw new AppError(403,'Administrator access is required.');
  return user;
}
async function reconcile(database: SQL) {
  // A cancelled/missing/terminal job cannot leave the global admission slot occupied.
  await database`update benchmark_runs r set state=case when a.state='cancelled' then 'cancelled' else 'failed' end,
    finished_at=now(),errors=r.errors || jsonb_build_array(case when a.state='cancelled' then 'cancelled' else 'job-ended' end)
    from (select r.id,a.state from benchmark_runs r left join outbox_actions a on a.id=r.action_id
      where r.state in ('queued','running') and (a.id is null or a.state in ('failed','succeeded','cancelled'))) a
    where r.id=a.id and r.state in ('queued','running')`;
  // Workers recover ordinary leases themselves. Mark only abandoned benchmark work,
  // whose entire workload is bounded to 30 seconds, after the existing 5 minute lease.
  await database`with abandoned as (update outbox_actions a set state='failed',locked_at=null,
    last_error='Benchmark interrupted. Run a new benchmark.',updated_at=now()
    where a.kind='benchmark.run' and a.state='running' and a.locked_at<now()-interval '5 minutes' returning a.id)
    update benchmark_runs r set state='failed',finished_at=now(),errors=r.errors || '["interrupted"]'::jsonb
    where r.action_id in (select id from abandoned) and r.state in ('queued','running')`;
}
export async function listBenchmarks(actor: SessionUser | null, page=1) {
  await currentAdmin(getSql(),actor);
  const selected=Math.max(1,Math.min(100000,Math.floor(Number(page)||1)));
  await reconcile(getSql());
  const [count]=await getSql()`select count(*)::int as total from benchmark_runs`;
  const pages=Math.max(1,Math.ceil(count.total/20)), actual=Math.min(selected,pages);
  const rows=await getSql()`select r.*,p.previous from
    (select * from benchmark_runs order by created_at desc,id desc limit 20 offset ${(actual-1)*20}) r
    left join lateral (select jsonb_agg(to_jsonb(candidate) order by candidate.created_at desc,candidate.id desc) as previous from (
      (select * from benchmark_runs previous where previous.comparison_key=r.comparison_key
        and previous.state='completed' and previous.errors <@ '["dataset-changed"]'::jsonb and (previous.created_at,previous.id)<(r.created_at,r.id)
        order by previous.created_at desc,previous.id desc limit 1)
      union
      (select * from benchmark_runs previous where previous.comparison_key=r.comparison_key
        and previous.context->>'datasetFingerprint'=r.context->>'datasetFingerprint' and previous.state='completed'
        and previous.errors='[]'::jsonb and (previous.created_at,previous.id)<(r.created_at,r.id)
        order by previous.created_at desc,previous.id desc limit 1)
    ) candidate) p on true
    order by r.created_at desc,r.id desc`;
  const runs:BenchmarkRun[]=rows.map((row:Record<string,any>)=>{
    const run=mapRun(row);
    for(const previous of row.previous??[]){
      const comparison=compareBenchmarks(run,mapRun(previous));
      if(!comparison)continue;
      for(const [name,value] of Object.entries(comparison.comparisons)){
        if(run.comparisons?.[name])continue;
        (run.comparisons??={})[name]=value;(run.changes??={})[name]=value.percent;
      }
      run.previousId??=comparison.previousId;
    }
    return run;
  });
  const [active]=await getSql()`select id from benchmark_runs where state in ('queued','running') limit 1`;
  return {runs,total:count.total,page:actual,pages,activeId:active?.id??null};
}
export async function startBenchmark(actor: SessionUser | null) {
  requireAdmin(actor);
  return getSql().begin(async database=>{
    await database`select pg_advisory_xact_lock(hashtextextended('benchmark-admission',0))`;
    const user=await currentAdmin(database,actor);
    await reconcile(database);
    const [active]=await database`select * from benchmark_runs where state in ('queued','running') limit 1`;
    if (active) return {run:mapRun(active),alreadyRunning:true};
    const id=crypto.randomUUID(), actionId=crypto.randomUUID();
    await database`insert into outbox_actions(id,user_id,kind,payload) values(${actionId},${user.id},'benchmark.run',${{runId:id}}::jsonb)`;
    const [row]=await database`insert into benchmark_runs(id,user_id,action_id,workload_version) values(${id},${user.id},${actionId},${benchmarkVersion}) returning *`;
    return {run:mapRun(row),alreadyRunning:false};
  });
}

async function readOptional(path:string) {try {return (await Bun.file(path).text()).trim();}catch{return null;}}
let buildIdentity:Promise<string>|undefined;
export function benchmarkBuildIdentity() {
  return buildIdentity??=(async()=>{
    const named=process.env.COAST_BUILD_ID;
    if (named && /^[a-zA-Z0-9._-]{1,100}$/.test(named) && named!=='unknown') return named;
    const built=Bun.file('build/server/index.js');
    if (process.env.NODE_ENV==='production' && await built.exists()) return serverBuildIdentity('build');
    // Development comparisons identify the executable workload, not a dirty Git ref.
    const files=['src/lib/benchmarks/service.server.ts','src/lib/benchmarks/model.ts','src/lib/collection/query.server.ts','src/lib/collection/freshness.server.ts','src/lib/profile/journal.ts','src/lib/ui/shelves/journal-visible.ts'];
    const root=new URL('../../../',import.meta.url);
    return 'dev-sha256:'+hash(await Promise.all(files.map(file=>Bun.file(new URL(file,root)).text())));
  })();
}
async function dataset(database: SQL,userId:string) {
  const [row]=await database`select (select count(*)::int from works) as works,
    (select count(*)::int from episodes) as episodes,(select count(*)::int from media_relationships) as relationships,
    (select count(*)::int from tracking_state where user_id=${userId}) as tracking,
    (select count(*)::int from tracking_events where user_id=${userId}) as history,
    (select count(*)::int from availability where user_id=${userId}) as availability,
    (select count(*)::int from list_items i join lists l on l.id=i.list_id where l.user_id=${userId}) as list_items,
    (select coalesce(jsonb_object_agg(scope||':'||domain,revision::text),'{}'::jsonb) from content_revisions where scope in ('global',${userId})) as revisions,
    (select settings from users where id=${userId}) as preferences,
    (select value from system_settings where key='coast') as policy,
    current_date::text as date,${collectionFreshnessSql(userId,database)} as freshness`;
  const counts=Object.fromEntries(['works','episodes','relationships','tracking','history','availability','list_items'].map(key=>[key,Number(row[key])]));
  return {counts,fingerprint:hash([userId,row.revisions,row.preferences,row.policy,row.date,row.freshness,counts])};
}
async function environment(database:SQL, data:Awaited<ReturnType<typeof dataset>>):Promise<BenchmarkContext> {
  const processors=cpus();
  const [db]=await database`select version() as version,current_setting('shared_buffers') as shared_buffers,
    current_setting('work_mem') as work_mem,current_setting('max_connections') as max_connections`;
  const context={build:await benchmarkBuildIdentity(),runtime:`Bun ${Bun.version}`,platform:process.platform,arch:process.arch,
    osRelease:release(),cpuModel:processors[0]?.model??'unknown',cpuCount:processors.length,hostMemoryBytes:totalmem(),
    backgroundJobs:Number((await database`select count(*)::int as total from outbox_actions where state='running' and kind<>'benchmark.run'`)[0].total),
    memoryLimit:await readOptional('/sys/fs/cgroup/memory.max'),cpuLimit:await readOptional('/sys/fs/cgroup/cpu.max'),
    database:db.version as string,databaseSettings:{shared_buffers:db.shared_buffers,work_mem:db.work_mem,max_connections:db.max_connections},
    dataset:data.counts,datasetFingerprint:data.fingerprint};
  return {...context,environmentFingerprint:hash({...context,build:undefined,dataset:undefined,datasetFingerprint:undefined})};
}
const memory=()=>{const {rss,heapUsed,external}=process.memoryUsage();return {rss,heapUsed,external};};

/** Only these bounded local read probes are executed; no provider adapter or domain
 * mutation is reachable. SQL runs in a read-only transaction with per-statement caps. */
export async function executeBenchmark(action:OutboxAction) {
  const runId=action.payload.runId;
  if (typeof runId!=='string' || !/^[0-9a-f-]{36}$/i.test(runId)) throw new PermanentActionError('Invalid benchmark run.');
  const connection=await getSql().reserve();
  let held=false, started=performance.now(), usedCpu:ReturnType<typeof process.cpuUsage>|null=null, context:BenchmarkContext|null=null, measurements:BenchmarkMeasurements|null=null;
  try {
    const [lock]=await connection`select pg_try_advisory_lock(hashtextextended('benchmark-execution',0)) as acquired`;
    if (!lock.acquired) throw new Error('benchmark-busy');
    held=true;
    const [eligible]=await connection`select r.id,r.state,r.workload_version,u.role,u.disabled,a.state as job_state,a.attempts
      from benchmark_runs r left join users u on u.id=r.user_id left join outbox_actions a on a.id=r.action_id
      where r.id=${runId} and r.action_id=${action.id} and r.user_id=${action.userId}`;
    if (!eligible || !['queued','running'].includes(eligible.state)) return;
    if (eligible.role!=='admin' || eligible.disabled) throw new Error('administrator-unavailable');
    if (eligible.workload_version!==benchmarkVersion) throw new Error('workload-changed');
    if (eligible.job_state!=='running' || eligible.attempts!==action.attempts) throw new Error('job-lease-lost');
    await connection`update benchmark_runs set state='running',started_at=now(),
      errors=case when state='running' then errors || '["restarted"]'::jsonb else errors end where id=${runId}`;
    const before=memory(), cpu=process.cpuUsage();usedCpu=cpu;
    measurements={wallMs:0,cpuUserMs:0,cpuSystemMs:0,memoryBefore:before,memoryAfter:before,
      peakObservedRss:before.rss,peakObservedHeap:before.heapUsed,probes:{},datasetChanged:false,backgroundActivity:false};
    const observe=()=>{const m=memory();measurements!.peakObservedRss=Math.max(measurements!.peakObservedRss,m.rss);measurements!.peakObservedHeap=Math.max(measurements!.peakObservedHeap,m.heapUsed);};
    const timer=setInterval(observe,50);timer.unref();
    try {
      await connection.begin(async database=>{
        await database`set transaction read only`;
        await database`set local statement_timeout='5s'`;
        await database`set local jit=off`;
        await database`set local recursive_worktable_factor=0.01`;
        const initial=await dataset(database,action.userId);
        context=await environment(database,initial);
        const check=()=>{if(performance.now()-started>30_000)throw new Error('workload-deadline');};
        const probe=async(name:string,work:()=>Promise<number>,repeats=5)=>{
          check();await work();check(); // One explicit untimed warm-up; no claim of a cold cache.
          const samples:number[]=[];let rows=0;
          for(let round=0;round<repeats;round++){check();const t=performance.now();rows=await work();check();samples.push(performance.now()-t);observe();
            const [busy]=await database`select count(*)::int as total from outbox_actions where state='running' and kind<>'benchmark.run'`;
            if(busy.total>0)measurements!.backgroundActivity=true;}
          measurements!.probes[name]=summarizeSamples(samples,rows);
        };
        await probe('Database round trip',async()=>{await database`select 1`;return 1;},10);
        const dialect=new PgDialect(), config=await getConfig(database);
        const enabled=statement`(category='screen' or (category='music' and ${config.experimentalMusic}) or (category='game' and ${config.experimentalGaming}))`;
        const page=dialect.sqlToQuery(statement`${collectionCTE(action.userId,action.userId,'all','personal')} select count(*)::int as total,
          (select jsonb_agg(page) from (select * from collection where ${enabled} order by lower(title),id limit 60) page) as items from collection where ${enabled}`);
        await probe('Collection membership and page',async()=>{const [row]=await database.unsafe(page.sql,page.params);return row?.items?.length??0;});
        const ids=(await database`select media_id as id from tracking_state where user_id=${action.userId} order by media_id limit 60`).map((row:Record<string,any>)=>row.id as string);
        const assessment=dialect.sqlToQuery(statement`${collectionCTE(action.userId,action.userId,'all',ids)} select count(*)::int as total,md5(jsonb_agg(a order by a.id)::text) as result from assessments a`);
        await probe('Collection assessment',async()=>{const [row]=await database.unsafe(assessment.sql,assessment.params);return Number(row?.total??0);});
        const entries=Array.from({length:6000},(_,index)=>({id:`fixture-${index}`,eventId:`fixture-event-${index}`,kind:'movie',title:'Benchmark fixture',watchedAt:`2026-01-${String(28-Math.floor(index/250)).padStart(2,'0')}T12:00:00Z`,source:'fixture',rewatched:false}) as JournalEntry);
        const days=journalGroups(entries).map(day=>day.date);
        await probe('Journal 6000 events',async()=>{let rows=0;for(let repeat=0;repeat<50;repeat++)rows+=visibleJournalEntries(entries,days,7).length;return rows/50;});
        const final=await dataset(database,action.userId);
        measurements!.datasetChanged=initial.fingerprint!==final.fingerprint;
        const [activity]=await database`select count(*)::int as total from outbox_actions where state='running' and kind<>'benchmark.run'`;
        measurements!.backgroundActivity=measurements!.backgroundActivity || context!.backgroundJobs>0 || activity.total>0;
      });
    } finally {clearInterval(timer);observe();}
    const used=process.cpuUsage(cpu);
    measurements.wallMs=performance.now()-started;measurements.cpuUserMs=used.user/1000;measurements.cpuSystemMs=used.system/1000;measurements.memoryAfter=memory();
    const key=!measurements.backgroundActivity && context?hash([benchmarkVersion,(context as BenchmarkContext).environmentFingerprint]):null;
    // A stale worker must never publish into the replacement lease's result.
    await connection`update benchmark_runs r set state='completed',finished_at=now(),context=${context}::jsonb,
      measurements=${measurements}::jsonb,comparison_key=${key},errors=case when ${measurements.datasetChanged} then errors || '["dataset-changed"]'::jsonb else errors end
      where r.id=${runId} and r.state='running' and exists(select 1 from outbox_actions a where a.id=${action.id} and a.state='running' and a.attempts=${action.attempts})`;
    return {checked:measurements.probes['Collection assessment']?.rows??0};
  } catch(error) {
    if(measurements && usedCpu){const used=process.cpuUsage(usedCpu);measurements.wallMs=performance.now()-started;measurements.cpuUserMs=used.user/1000;measurements.cpuSystemMs=used.system/1000;measurements.memoryAfter=memory();}
    const message=error instanceof Error?error.message:'';
    const code=['benchmark-busy','administrator-unavailable','workload-changed','job-lease-lost','workload-deadline'].includes(message)?message:
      (error as {errno?:string})?.errno==='57014'?'statement-timeout':'probe-failed';
    if(code==='benchmark-busy')throw new Error('A benchmark is already executing.');
    await connection`update benchmark_runs set state='failed',finished_at=now(),context=${context}::jsonb,
      measurements=${measurements}::jsonb,errors=errors || jsonb_build_array(${code}::text) where id=${runId} and state in ('queued','running')
      and exists(select 1 from outbox_actions where id=${action.id} and state='running' and attempts=${action.attempts})`;
    throw new PermanentActionError(`Benchmark could not complete (${code}). Run a new benchmark.`);
  } finally {
    try {if(held)await connection`select pg_advisory_unlock(hashtextextended('benchmark-execution',0))`;}finally{connection.release();}
  }
}
