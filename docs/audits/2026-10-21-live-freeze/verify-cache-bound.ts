// Controlled query-shape stress using genuine catalogue rows; not a production traffic mix.
import {SQL} from 'bun';
import {createHash} from 'node:crypto';
const options=JSON.parse(await Bun.stdin.text());
if(options.database!=='coast_freeze_probe_20261021')throw Error('Private database required');
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const db=new SQL({...options,max:1,idleTimeout:0,connectionTimeout:3,connection:{jit:'off',statement_timeout:4000}});
const report:any={bun:Bun.version,controlledShapes:true,samples:[],status:'failed'};
let stage='actual-input';
try{
 const actual=await db`select * from public.media order by id limit 32`;
 if(actual.length!==32)throw Error('Actual cohort absent');
 const columns=['kind','title','original_title','overview','poster_path','backdrop_path','release_date','year','runtime_minutes','genres','created_at','updated_at'];
 const query=(n:number)=>{
  const selected=['id',...columns.filter((_,i)=>(n&(1<<i))!==0)];
  return {text:`select ${selected.map(x=>'"'+x+'"').join(',')} from public.media where id=$1::uuid`,selected};
 };
 const check=(row:any,selected:string[])=>{
  const expected=Object.fromEntries(selected.map(k=>[k,actual[0][k]]));
  if(hash(row)!==hash(expected))throw Error('Actual projection changed');
 };
 stage='eviction-pressure';
 for(let n=1;n<=2200;n++){
  const q=query(n),[row]=await db.unsafe(q.text,[actual[0].id]);check(row,q.selected);
  if([300,900,1100,1500,2200].includes(n)){
   const [memory]=await db`select (select count(*)::int from pg_prepared_statements) as statements,sum(total_bytes)::bigint as bytes from pg_backend_memory_contexts`;
   report.samples.push({shapes:n,...memory});
   if(Number(memory.bytes)>128*1024*1024)throw Error('Private memory budget reached');
  }
 }
 stage='type-compatible-reuse';
 const withYear=actual.find((r:any)=>r.year!==null),withNull=actual.find((r:any)=>r.original_title===null);
 if(!withYear||!withNull)throw Error('Actual type cohort absent');
 for(const value of [withYear.year,actual[0].title,withNull.original_title,withYear.year,actual[0].title]){
  const [result]=await db`select ${value} as value`;
  if(result.value!==value)throw Error('Type-contaminated reuse');
 }
 stage='concurrent-eviction';
 const reserved=await db.reserve();
 try{
  await reserved`select pg_advisory_lock(hashtextextended(${actual[0].id},0))`;
  const results=await Promise.all(Array.from({length:80},async(_,i)=>{
   const q=query(2300+i),[row]=await reserved.unsafe(q.text,[actual[0].id]);check(row,q.selected);return true;
  }));
  report.concurrentProjections=results.length;
  stage='cancelled-query';
  const pending=reserved`select id from public.media where id=${actual[0].id}::uuid and (select pg_sleep(1)) is null`;
  const finished=Promise.resolve(pending).then(()=>false,()=>true);
  await Bun.sleep(50);pending.cancel();report.cancelRejected=await finished;
  const [{held}]=await reserved`select exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted) as held`;
  if(!report.cancelRejected||!held)throw Error('Cancellation lost reservation or did not reject');
  report.lockSurvivesCancellation=held;
  await reserved`select pg_advisory_unlock_all()`;
 }finally{reserved.release();}
 stage='transaction-error';
 let rejected=false;
 try{
  await db.begin(async tx=>{
   try{await tx`insert into public.media select * from public.media where id=${actual[0].id}::uuid`;}catch{}
   return 'must not claim committed';
  });
 }catch{rejected=true;}
 if(!rejected)throw Error('Aborted transaction reported committed');
 report.abortedTransactionRejected=true;
 const copy=await db`select * from public.media order by id limit 32`;
 if(hash(copy)!==hash(actual))throw Error('Error paths changed actual rows');
 const [after]=await db`select (select count(*)::int from pg_prepared_statements) as statements,sum(total_bytes)::bigint as bytes from pg_backend_memory_contexts`;
 report.after=after;report.rowHash=hash(actual);report.status='passed';
}catch(error){report.stage=stage;report.code=String((error as any)?.code??'unknown');}
finally{await db.close({timeout:2});}
console.log(JSON.stringify(report));
if(report.status!=='passed')process.exitCode=1;
