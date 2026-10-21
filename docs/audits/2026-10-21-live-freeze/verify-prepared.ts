// Run with the deployed Linux Bun against the disposable catalogue subset only.
// Connection options arrive on stdin and never enter the report or argv.
import {SQL} from 'bun';
import {createHash} from 'node:crypto';
import {drizzle} from 'drizzle-orm/bun-sql';
import {sql} from 'drizzle-orm';
import {media,metadataSnapshots} from '/app/src/lib/server/db/schema.ts';

const options=JSON.parse(await Bun.stdin.text());
if(options.database!=='coast_freeze_probe_20261021')throw Error('Disposable database required');
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const report:any={bun:Bun.version,platform:process.platform,source:'Previously approved actual catalogue checkpoint; media table only',trials:[]};
const nativeJson=metadataSnapshots.raw.mapToDriverValue;
for(const [prepare,codec] of [[true,'native'],[false,'native'],[false,'text-cast'],[true,'native'],[false,'text-cast']] as const){
 metadataSnapshots.raw.mapToDriverValue=codec==='native'?nativeJson:
  (value:unknown)=>sql`${JSON.stringify(value)}::text::jsonb`;
 let stage='connection';
 const db=new SQL({...options,max:1,idleTimeout:0,prepare,connectionTimeout:5,
  connection:{jit:'off',statement_timeout:3000,application_name:'coast-freeze-private-probe'}});
 try{
  const [{current_database:database}]=await db`select current_database()`;
  if(database!=='coast_freeze_probe_20261021')throw Error('Wrong database');
  const [{server_version:pg}]=await db`show server_version`;report.postgres=pg;
  const actual=await db`select * from public.media order by id limit 8000`;
  if(actual.length!==8000)throw Error('Actual cohort absent');
  const snapshot=async()=>{
   const [r]=await db`select (select count(*)::int from pg_prepared_statements) as statements,
    sum(total_bytes)::bigint as context_bytes,sum(used_bytes)::bigint as used_bytes,
    count(*) filter(where name='CachedPlanSource')::int as cached_sources,
    (select count(*)::int from pg_prepared_statements where statement like 'insert into "media"%') as bulk_statements,
    (select count(distinct statement)::int from pg_prepared_statements where statement like 'insert into "media"%') as bulk_sql_shapes
    from pg_backend_memory_contexts`;
   return {...r,clientRssBytes:process.memoryUsage().rss};
  };
  const before=await snapshot();
  await db`create temporary table media (like public.media including all)`;
  const orm=drizzle(db);
  const actualMetadata=await orm.select().from(metadataSnapshots).orderBy(metadataSnapshots.id).limit(32);
  if(actualMetadata.length!==32)throw Error('Actual metadata cohort absent');
  await db`create temporary table metadata_snapshots (like public.metadata_snapshots including all)`;
  stage='native-metadata-insert';
  await orm.insert(metadataSnapshots).values(actualMetadata);
  const metadataCopy=await orm.select().from(metadataSnapshots).orderBy(metadataSnapshots.id);
  if(digest(actualMetadata)!==digest(metadataCopy))throw Error('Native metadata JSON round trip changed');
  stage='actual-media-round-trip';
  const rows=actual.map((r:any)=>({id:r.id,kind:r.kind,title:r.title,originalTitle:r.original_title,
   overview:r.overview,posterPath:r.poster_path,backdropPath:r.backdrop_path,
   releaseDate:r.release_date instanceof Date?r.release_date.toISOString().slice(0,10):r.release_date,
   year:r.year,runtimeMinutes:r.runtime_minutes,genres:r.genres,createdAt:r.created_at,updatedAt:r.updated_at}));
  const start=performance.now();
  for(let i=0;i<rows.length;i+=50)await orm.insert(media).values(rows.slice(i,i+50));
  const insertMs=performance.now()-start,afterInsert=await snapshot();
  const copy=await db`select * from pg_temp.media order by id`;
  if(digest(actual)!==digest(copy))throw Error('Actual row round trip changed');
  const ids=actual.slice(0,300).map((r:any)=>r.id);
  stage='varied-reads';
  const readStart=performance.now();
  for(let n=1;n<=300;n++){
   const values=ids.slice(0,n);
   const result=await db.unsafe(`select id from pg_temp.media where id in (${values.map((_,i)=>'$'+(i+1)+'::uuid').join(',')}) order by id`,values);
   if(digest(result.map((r:any)=>r.id))!==digest(values))throw Error('Actual ID membership/order changed');
  }
  const variedReadsMs=performance.now()-readStart,afterVaried=await snapshot();
  stage='fixed-shape-reads';
  const fixedStart=performance.now();
  for(let n=1;n<=300;n++){
   const result=await db`select id from pg_temp.media where id=any(${db.array(ids.slice(0,n),'UUID')}) order by id`;
   if(digest(result.map((r:any)=>r.id))!==digest(ids.slice(0,n)))throw Error('Fixed-shape membership/order changed');
  }
  const fixedReadsMs=performance.now()-fixedStart,afterFixed=await snapshot();
  stage='rollback-and-reservation';
  const rollback=Error('Expected private rollback');
  try{await db.begin(async tx=>{await tx`delete from pg_temp.media where id=${ids[0]}::uuid`;throw rollback;});}
  catch(error){if(error!==rollback)throw error;}
  const [{count}]=await db`select count(*)::int as count from pg_temp.media`;
  if(count!==actual.length)throw Error('Rollback changed actual row count');
  if(digest(actual)!==digest(await db`select * from pg_temp.media order by id`))throw Error('Rollback changed actual rows');
  const reserved=await db.reserve();
  try{
   const [{pid}]=await reserved`select pg_backend_pid()::int as pid`;
   await reserved`select pg_advisory_lock(hashtextextended(${ids[0]},0))`;
   const [{same,held}]=await reserved`select pg_backend_pid()=${pid} as same,exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted) as held`;
   if(!same||!held)throw Error('Reservation lost advisory lease');
   await reserved`select pg_advisory_unlock_all()`;
  }finally{reserved.release();}
  report.trials.push({prepare,codec,actualRows:actual.length,rowHash:digest(actual),metadataRows:actualMetadata.length,metadataHash:digest(actualMetadata),before,afterInsert,afterVaried,afterFixed,insertMs,variedReadsMs,fixedReadsMs,rollback:true,reservation:true,status:'passed'});
  console.log(JSON.stringify(report.trials.at(-1)));
 }catch(error){
  const cause=(error as any)?.cause??error;
  const code=String((cause as any)?.errno??(cause as any)?.code??'unknown');
  report.trials.push({prepare,codec,status:'failed',stage,code,expectedFailure:!prepare&&codec==='native'&&code==='22P02'});
  console.log(JSON.stringify(report.trials.at(-1)));
 }finally{await db.close({timeout:2});metadataSnapshots.raw.mapToDriverValue=nativeJson;}
}
console.log(JSON.stringify({report}));
if(report.trials.some((trial:any)=>trial.status!=='passed'&&!trial.expectedFailure))process.exitCode=1;
