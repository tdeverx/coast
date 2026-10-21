// Private actual-data lease tests; stdin contains connection options, no output rows.
import {SQL} from 'bun';
const options=JSON.parse(await Bun.stdin.text());
if(options.database!=='coast_freeze_probe_20261021')throw Error('Disposable database required');
const report:any={bun:Bun.version,postgres:'15.19',cases:[]};
for(const maxLifetime of [0,1]){
 const db=new SQL({...options,max:1,idleTimeout:0,maxLifetime,connectionTimeout:3,
  connection:{jit:'off',statement_timeout:4000}});
 const [{id}]=await db`select id from public.media order by id limit 1`;
 try{
  let stage='reserved-idle';
  const reserved=await db.reserve();
  let reservedPid:number|undefined;
  try{
   const [{pid}]=await reserved`select pg_backend_pid()::int as pid`;
   reservedPid=pid;
   await reserved`select pg_advisory_lock(hashtextextended(${id},0))`;
   await Bun.sleep(1400);
   const [{same,held}]=await reserved`select pg_backend_pid()=${pid} as same,exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted) as held`;
   report.cases.push({maxLifetime,stage,sameBackend:same,lockHeld:held,status:same&&held?'passed':'failed'});
   await reserved`select pg_advisory_unlock_all()`;
  }catch(error){report.cases.push({maxLifetime,stage,status:'failed',code:String((error as any)?.code??'unknown')});}
  finally{reserved.release();}
  if(reservedPid!==undefined){
   const [{pid}]=await db`select pg_backend_pid()::int as pid`;
   const retired=pid!==reservedPid;
   report.cases.push({maxLifetime,stage:'after-reservation-release',retired,status:retired===(maxLifetime>0)?'passed':'failed'});
  }
  stage='active-transaction';
  try{
   await db.begin(async tx=>{
    await tx`update public.media set title=title where id=${id}::uuid`;
    await Bun.sleep(1400);
    const [{present}]=await tx`select exists(select 1 from public.media where id=${id}::uuid) as present`;
    if(!present)throw Error('Actual row lost');
   });
   report.cases.push({maxLifetime,stage,status:'passed'});
  }catch(error){report.cases.push({maxLifetime,stage,status:'failed',code:String((error as any)?.code??'unknown')});}
 }finally{await db.close({timeout:1});}
}
console.log(JSON.stringify(report));
