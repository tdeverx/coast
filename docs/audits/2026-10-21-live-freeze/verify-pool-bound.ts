// Controlled shape cardinality on actual rows, using the application's ten-session pool size.
import {SQL} from 'bun';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const options=JSON.parse(await Bun.stdin.text());
if(options.database!=='coast_freeze_probe_20261021')throw Error('Private database required');
const db=new SQL({...options,max:10,idleTimeout:0,connectionTimeout:5,connection:{jit:'off',statement_timeout:4000}});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report:any={bun:Bun.version,sessions:10,samples:[],status:'failed'};
const reservations:any[]=[];
try{
 const [actual]=await db`select * from public.media order by id limit 1`;
 if(!actual)throw Error('Actual cohort absent');
 const fields=['kind','title','original_title','overview','poster_path','backdrop_path','release_date','year','runtime_minutes','genres','created_at','updated_at'];
 reservations.push(...await Promise.all(Array.from({length:10},()=>db.reserve())));
 for(let n=1;n<=1600;n++){
  const selected=['id',...fields.filter((_,i)=>(n&(1<<i))!==0)];
  const text=`select ${selected.map(x=>'"'+x+'"').join(',')} from public.media where id=$1::uuid`;
  const expected=hash(Object.fromEntries(selected.map(k=>[k,actual[k]])));
  await Promise.all(reservations.map(async client=>{
   const [row]=await client.unsafe(text,[actual.id]);
   if(hash(row)!==expected)throw Error('Actual pool projection changed');
  }));
  if([300,900,1200,1600].includes(n)){
   const memory=await Promise.all(reservations.map(async client=>{
    const [m]=await client`select pg_backend_pid()::int as pid,(select count(*)::int from pg_prepared_statements) as statements,
     sum(total_bytes)::bigint as bytes from pg_backend_memory_contexts`;
    const smaps=await readFile('/proc/'+m.pid+'/smaps_rollup','utf8').catch(()=>null);
    return {...m,pssKiB:smaps?Number(smaps.match(/^Pss:\s*(\d+)/m)?.[1]):null};
   }));
   const current=Number((await readFile('/sys/fs/cgroup/memory.current','utf8')).trim());
   report.samples.push({shapesPerSession:n,statements:memory.map(x=>x.statements),backendContextBytes:memory.reduce((s,x)=>s+Number(x.bytes),0),
    backendPssKiB:memory.every(x=>x.pssKiB!==null)?memory.reduce((s,x)=>s+x.pssKiB,0):null,containerBytes:current,clientRssBytes:process.memoryUsage().rss});
   if(memory.some(x=>x.statements>1024))throw Error('Server cache bound exceeded');
   if(current>850*1024*1024)throw Error('Private VM budget approached');
  }
 }
 report.rowHash=hash(actual);report.status='passed';
}catch(error){report.code=String((error as any)?.code??'unknown');}
finally{for(const client of reservations)client.release();await db.close({timeout:2});}
console.log(JSON.stringify(report));
if(report.status!=='passed')process.exitCode=1;
