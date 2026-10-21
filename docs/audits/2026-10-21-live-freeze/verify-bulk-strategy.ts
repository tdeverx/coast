// Research only: actual rows, native JSON, stable query shape; never the live database.
import {SQL} from 'bun';
import {createHash} from 'node:crypto';
import {drizzle} from 'drizzle-orm/bun-sql';
import {media,metadataSnapshots} from '/app/src/lib/server/db/schema.ts';
const input=JSON.parse(await Bun.stdin.text()),{connection,mode}=input;
if(connection.database!=='coast_freeze_probe_20261021'||!['default','recordset'].includes(mode))throw Error('Private target/mode required');
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const db=new SQL({...connection,max:1,idleTimeout:0,connectionTimeout:3,connection:{jit:'off',statement_timeout:4000}});
const report:any={bun:Bun.version,mode,cycles:[],status:'failed'};
let stage='setup';
try{
 const actual=await db`select * from public.media order by id limit 8000`;
 if(actual.length!==8000)throw Error('Missing actual cohort');
 const orm=drizzle(db);
 const metadata=await orm.select().from(metadataSnapshots).orderBy(metadataSnapshots.id).limit(32);
 await db`create temporary table media (like public.media including all)`;
 await db`create temporary table metadata_snapshots (like public.metadata_snapshots including all)`;
 await orm.insert(metadataSnapshots).values(metadata);
 if(hash(metadata)!==hash(await orm.select().from(metadataSnapshots).orderBy(metadataSnapshots.id)))throw Error('Native metadata changed');
 const encode=(r:any)=>({id:r.id,kind:r.kind,title:r.title,originalTitle:r.original_title,overview:r.overview,
  posterPath:r.poster_path,backdropPath:r.backdrop_path,releaseDate:r.release_date instanceof Date?r.release_date.toISOString().slice(0,10):r.release_date,
  year:r.year,runtimeMinutes:r.runtime_minutes,genres:r.genres,createdAt:r.created_at,updatedAt:r.updated_at});
 const snapshot=async()=>{
  const [m]=await db`select sum(total_bytes)::bigint as "contextBytes",sum(used_bytes)::bigint as "usedBytes",
   (select count(*)::int from pg_prepared_statements) as statements,
   (select count(*)::int from pg_prepared_statements where statement like 'insert into%media%') as "bulkStatements",
   (select count(distinct statement)::int from pg_prepared_statements where statement like 'insert into%media%') as "bulkSqlShapes"
   from pg_backend_memory_contexts`;
  if(!Number.isFinite(Number(m.contextBytes)))throw Error('Memory counter absent');
  return {...m,clientRssBytes:process.memoryUsage().rss};
 };
 report.before=await snapshot();
 for(let round=0;round<8;round++){
  stage='rotated-actual-batches';
  await db`delete from pg_temp.media`;
  const ordered=[...actual.slice(round),...actual.slice(0,round)];
  const started=performance.now();
  for(let i=0;i<ordered.length;i+=50){
   const batch=ordered.slice(i,i+50);
   if(mode==='default')await orm.insert(media).values(batch.map(encode));
   else await db`insert into pg_temp.media select * from jsonb_populate_recordset(null::public.media,${batch}::jsonb)`;
  }
  const insertMs=performance.now()-started;
  const copy=await db`select * from pg_temp.media order by id`;
  if(hash(copy)!==hash(actual))throw Error('Complete actual row equality failed');
  const memory=await snapshot();
  report.cycles.push({round,insertMs,...memory});
  // Bound the experiment before it can exhaust the one-GiB guest.
  if(Number(memory.contextBytes)>128*1024*1024){report.budgetStop=true;break;}
 }
 stage='upsert';
 const batch=actual.slice(0,50);
 if(mode==='recordset'){
  await db`insert into pg_temp.media select * from jsonb_populate_recordset(null::public.media,${batch}::jsonb)
   on conflict(id) do update set kind=excluded.kind,title=excluded.title,original_title=excluded.original_title,overview=excluded.overview,
   poster_path=excluded.poster_path,backdrop_path=excluded.backdrop_path,release_date=excluded.release_date,year=excluded.year,
   runtime_minutes=excluded.runtime_minutes,genres=excluded.genres,created_at=excluded.created_at,updated_at=excluded.updated_at`;
  if(hash(actual)!==hash(await db`select * from pg_temp.media order by id`))throw Error('Upsert changed complete actual rows');
 }
 stage='prepared-fixed-reads';
 const ids=actual.slice(0,300).map((r:any)=>r.id);
 report.fixedReadsMs=[];
 for(let round=0;round<4;round++){
  const started=performance.now();
  for(let n=1;n<=300;n++){
   const rows=await db`select id from pg_temp.media where id=any(${db.array(ids.slice(0,n),'UUID')}) order by id`;
   if(hash(rows.map((r:any)=>r.id))!==hash(ids.slice(0,n)))throw Error('Fixed reads changed membership/order');
  }
  report.fixedReadsMs.push(performance.now()-started);
 }
 stage='rollback';
 const expected=Error('Private rollback');
 try{await db.begin(async tx=>{await tx`delete from pg_temp.media where id=${ids[0]}::uuid`;throw expected;});}
 catch(e){if(e!==expected)throw e;}
 if(hash(actual)!==hash(await db`select * from pg_temp.media order by id`))throw Error('Rollback changed actual rows');
 report.rowHash=hash(actual);report.metadataHash=hash(metadata);report.after=await snapshot();report.status='passed';
}catch(error){report.stage=stage;report.code=String(((error as any)?.cause??error)?.code??'unknown');}
finally{await db.close({timeout:2});}
console.log(JSON.stringify(report));
if(report.status!=='passed')process.exitCode=1;
