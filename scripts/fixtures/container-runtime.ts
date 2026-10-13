// Runs only inside a disposable Linux container; all databases/keys are freshly generated.
import {mkdtempSync,chmodSync,mkdirSync,openSync,closeSync,readFileSync,chownSync} from 'node:fs';
const directory=mkdtempSync('/tmp/coast-runtime-fixture-');chmodSync(directory,0o755);
const pg='/usr/lib/postgresql/15/bin', base='http://127.0.0.1:3971';
const children:Bun.Subprocess[]=[];
let frozenPids:number[]=[];
function assert(ok:unknown,reason:string):asserts ok {if(!ok)throw Error(reason);}
function processState(pid:number):string|undefined {
  try {
    // procfs reports size zero. Use the filesystem reader rather than Bun.file
    // sizing/caching behavior; empty metadata cannot prove a process survived.
    const stat=readFileSync('/proc/'+pid+'/stat','utf8'), end=stat.lastIndexOf(') ');
    const state=stat.slice(end+2).split(' ')[0];
    assert(end>=0&&/^[A-Zt]$/.test(state),'fixture process-state metadata unreadable');
    return state;
  } catch(error) {
    if(['ENOENT','ESRCH'].includes((error as NodeJS.ErrnoException).code||''))return;
    throw error;
  }
}
function spawn(args:string[],name:string,env:Record<string,string>={}) {
  const fd=openSync(directory+'/'+name+'.log','w',0o600);
  const child=Bun.spawn(args,{cwd:'/app',detached:true,env:{...process.env,...env},stdin:'ignore',stdout:fd,stderr:fd});
  children.push(child);void child.exited.then(()=>closeSync(fd));return child;
}
async function command(args:string[]) {
  const p=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});
  const [output,error,status]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  assert(status===0,'fixture command failed');return output.trim();
}
async function sql(query:string,socket='/var/run/postgresql',db='coast',user='coast') {
  return command(['gosu','postgres',pg+'/psql','-X','-q','-A','-t','-h',socket,'-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-c',query]);
}
async function health() {
  try {return (await fetch(base+'/api/v1/health',{signal:AbortSignal.timeout(2000)})).status;}catch{return 0;}
}
async function ready(child:Bun.Subprocess) {
  for(let i=0;i<100;i++){assert(child.exitCode===null,'supervisor exited before readiness');if(await health()===200)return;await Bun.sleep(100);}
  throw Error('fixture did not become ready');
}
async function exit(child:Bun.Subprocess,expected:number|undefined,deadline=8000) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {const result=await Promise.race([child.exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('supervisor deadline exceeded')),deadline);})]);if(expected!==undefined)assert(result===expected,`wrong supervisor status ${result}, expected ${expected}`);return result;}
  finally {if(timer)clearTimeout(timer);}
}
function start(name:string,env:Record<string,string>={}) {
  const data=directory+'/'+name;
  const child=spawn(['/bin/bash','/usr/local/bin/coast-entrypoint'],name,{COAST_DATA_DIR:data,DATABASE_URL:'',HOST:'127.0.0.1',PORT:'3971',ORIGIN:base,...env});
  return {child,data};
}
async function rows(data:string,name:string) {return (await Bun.file(data+'/runtime/'+name+'.jsonl').text()).trim().split('\n').map(line=>JSON.parse(line));}
async function cleanStop(item:{child:Bun.Subprocess;data:string}) {
  item.child.kill('SIGTERM');await exit(item.child,143);
  const history=await rows(item.data,'shutdown-events');
  const stages=history.slice(history.findLastIndex(r=>r.detail.stage==='start'));
  assert(stages.some(r=>r.detail.stage==='fast'&&r.detail.child==='database'),'missing fast stage');
  assert(!stages.some(r=>['immediate','kill','unreaped'].includes(r.detail.stage)),'clean stop required force');
  const database=await rows(item.data,'database-events');
  assert(database.slice(database.findLastIndex(r=>r.kind==='database.start')).some(r=>r.detail.code==='shutdown-complete'),'PG did not stop cleanly');
}
try {
  const normal=start('active-transaction');await ready(normal.child);
  await sql('CREATE TABLE coast_shutdown_fixture(id integer PRIMARY KEY); INSERT INTO coast_shutdown_fixture VALUES (1)');
  const held=spawn(['gosu','postgres',pg+'/psql','-X','-h','/var/run/postgresql','-U','coast','-d','coast','-v','ON_ERROR_STOP=1','-c','BEGIN; INSERT INTO coast_shutdown_fixture VALUES (2); SELECT pg_sleep(120); COMMIT;'],'held-transaction');
  let sleeping=false;
  for(let i=0;i<100;i++){if(await sql("SELECT count(*) FROM pg_stat_activity WHERE datname='coast' AND wait_event='PgSleep'")!=='0'){sleeping=true;break;}await Bun.sleep(20);}
  assert(sleeping,'active transaction fixture was not established');
  const started=performance.now();await cleanStop(normal);assert(performance.now()-started<8000,'fast shutdown waited for active session');
  assert(await held.exited!==0,'active transaction was not cancelled');
  const restored=start('active-transaction');await ready(restored.child);assert(await sql('SELECT count(*) FROM coast_shutdown_fixture')==='1','uncommitted transaction survived shutdown');await cleanStop(restored);
  console.log('active transaction: fast clean stop, committed row retained, open transaction rolled back');

  const deadApp=start('dead-app');await ready(deadApp.child);
  const samples=(await Bun.file(deadApp.data+'/runtime/samples/0.jsonl').text()).trim().split('\n').map(JSON.parse);
  const appPid=samples.at(-1).detail.pid;assert(Number.isInteger(appPid)&&appPid>1,'missing fixture app PID');
  process.kill(appPid,'SIGKILL');await exit(deadApp.child,137);assert(await health()!==200,'dead app reported healthy');
  assert((await rows(deadApp.data,'child-exits')).at(-1).child==='application','dead app attributed incorrectly');
  console.log('dead application: original137, bundled PG cleaned up, no healthy response');

  // An independent cluster proves ownership fallback cannot catch another DB.
  const otherData=directory+'/other-pg',otherSocket=directory+'/other-socket';
  mkdirSync(otherData,{mode:0o700});mkdirSync(otherSocket,{mode:0o700});chownSync(otherData,100,100);chownSync(otherSocket,100,100);
  await command(['gosu','postgres',pg+'/initdb','-D',otherData,'--auth=trust','--locale=C.UTF-8']);
  const otherPg=spawn(['gosu','postgres',pg+'/postgres','-D',otherData,'-c','listen_addresses=','-c','unix_socket_directories='+otherSocket],'other-db');
  for(let i=0;i<100;i++){try{await sql('SELECT 1',otherSocket,'postgres','postgres');break;}catch{await Bun.sleep(30);}}
  const deadDb=start('dead-db',{COAST_SHUTDOWN_APP_SECONDS:'1',COAST_SHUTDOWN_DATABASE_SECONDS:'1',COAST_SHUTDOWN_IMMEDIATE_SECONDS:'1'});await ready(deadDb.child);
  const orphanedBackend=Number(await sql("SELECT pid FROM pg_stat_activity WHERE datname='coast' AND backend_type='client backend' AND state='idle' LIMIT 1"));
  assert(Number.isInteger(orphanedBackend)&&orphanedBackend>1,'missing backend for postmaster-death fixture');
  frozenPids=[orphanedBackend];process.kill(orphanedBackend,'SIGSTOP');
  const dbPid=Number(readFileSync(deadDb.data+'/postgres/postmaster.pid','utf8').split('\n')[0]);
  process.kill(dbPid,'SIGKILL');const observed=await exit(deadDb.child,undefined);assert(await health()!==200,'dead DB reported healthy');
  const first=(await rows(deadDb.data,'child-exits')).at(-1);
  assert(observed!==0&&first.exitCode===observed&&['database','application'].includes(first.child),'first observed failure status was replaced');
  assert((await rows(deadDb.data,'database-events')).some(r=>r.kind==='database.exit'&&r.detail.exitCode===137),'DB137 evidence lost');
  const orphanState=processState(orphanedBackend);
  if(orphanState!==undefined){
    const state=orphanState;
    if(!['Z','X'].includes(state)) {
      const link=Bun.spawn(['gosu','postgres','readlink','--','/proc/'+orphanedBackend+'/cwd'],{stdout:'pipe',stderr:'pipe'});
      const [cwd,error,status]=await Promise.all([new Response(link.stdout).text(),new Response(link.stderr).text(),link.exited]);
      const comm=(await Bun.file('/proc/'+orphanedBackend+'/comm').text()).trim();
      console.error('fixture orphan metadata',JSON.stringify({state,comm,cwdReadable:status===0,cwdMatches:cwd.trim()===deadDb.data+'/postgres',readlinkStatus:status}));
      console.error('fixture shutdown stages',JSON.stringify(await rows(deadDb.data,'shutdown-events')));
    }
    assert(['Z','X'].includes(state),'orphaned backend survived postmaster death cleanup');
  }
  frozenPids=[];
  assert(otherPg.exitCode===null&&await sql('SELECT 1',otherSocket,'postgres','postgres')==='1','cleanup stopped an independent PostgreSQL cluster');
  otherPg.kill('SIGINT');await exit(otherPg,0);
  console.log('dead database: DB137 retained, frozen orphan backend state='+ (orphanState||'absent')+', independent cluster untouched, no healthy response');

  const forced=start('forced-db',{COAST_SHUTDOWN_APP_SECONDS:'1',COAST_SHUTDOWN_DATABASE_SECONDS:'1',COAST_SHUTDOWN_IMMEDIATE_SECONDS:'1'});await ready(forced.child);
  await sql('CREATE TABLE coast_shutdown_fixture(id integer PRIMARY KEY); INSERT INTO coast_shutdown_fixture VALUES (1)');
  const frozen=Number(readFileSync(forced.data+'/postgres/postmaster.pid','utf8').split('\n')[0]);
  const frozenBackend=Number(await sql("SELECT pid FROM pg_stat_activity WHERE datname='coast' AND backend_type='client backend' AND state='idle' LIMIT 1"));
  assert(Number.isInteger(frozenBackend)&&frozenBackend>1,'missing idle fixture backend');
  frozenPids=[frozen,frozenBackend];for(const pid of frozenPids)process.kill(pid,'SIGSTOP');
  forced.child.kill('SIGTERM');await exit(forced.child,143);
  const stages=await rows(forced.data,'shutdown-events');
  assert(stages.some(r=>r.detail.stage==='immediate'&&r.detail.child==='database'),'immediate escalation not recorded');
  assert(stages.some(r=>r.detail.stage==='kill'&&r.detail.child==='database'),'kill escalation not recorded');
  for(const pid of frozenPids){const state=processState(pid);assert(state===undefined||['Z','X'].includes(state),'owned PostgreSQL descendant survived force');}
  frozenPids=[];
  const recovered=start('forced-db');await ready(recovered.child);assert(await sql('SELECT count(*) FROM coast_shutdown_fixture')==='1','committed marker did not survive crash recovery');await cleanStop(recovered);
  console.log('frozen PostgreSQL: bounded INT/QUIT/KILL, status143, fresh-cluster crash recovery retained committed marker');

  const extData=directory+'/external-postgres',socket=directory+'/external-socket';
  mkdirSync(extData,{mode:0o700});mkdirSync(socket,{mode:0o700});chownSync(extData,100,100);chownSync(socket,100,100);
  await command(['gosu','postgres',pg+'/initdb','-D',extData,'--auth=trust','--locale=C.UTF-8','--data-checksums']);
  const pgArgs=['gosu','postgres',pg+'/postgres','-D',extData,'-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+socket];
  let external=spawn(pgArgs,'external-db');
  for(let i=0;i<100;i++){try{await sql('SELECT 1',socket,'postgres','postgres');break;}catch{await Bun.sleep(50);}}
  await sql('CREATE DATABASE coast_runtime_external',socket,'postgres','postgres');
  const front=start('external-front',{DATABASE_URL:'postgresql://postgres@127.0.0.1:5432/coast_runtime_external'});await ready(front.child);
  // PostgreSQL backends have their own groups; freeze only this fresh server's
  // known frontend connections plus its postmaster (preventing new connects).
  const backendPids=(await sql("SELECT pid FROM pg_stat_activity WHERE datname='coast_runtime_external' AND backend_type='client backend'",socket,'postgres','postgres')).split('\n').filter(Boolean).map(Number);
  frozenPids=[external.pid,...backendPids];
  for(const pid of frozenPids)process.kill(pid,'SIGSTOP');
  const probeStarted=performance.now(), stalledStatus=await health();assert(stalledStatus===503,`stalled external DB status ${stalledStatus}, expected503`);assert(performance.now()-probeStarted<1800,'readiness probe exceeded its bound');
  for(const pid of frozenPids){try{process.kill(pid,'SIGCONT');}catch{}}frozenPids=[];await ready(front.child);
  console.log('external stall: bounded503, recovery200 in same frontend');
  // Force actual queue-claim transactions to remain pending during disconnect.
  // This reproduces unawaited transaction-fragment rejection deterministically.
  const outage=front;
  const holder=spawn(['gosu','postgres',pg+'/psql','-X','-h',socket,'-U','postgres','-d','coast_runtime_external','-v','ON_ERROR_STOP=1','-c',"SELECT pg_advisory_lock(hashtextextended('queue-claim',0)); SELECT pg_sleep(120)"],'queue-claim-holder');
  let blocked=false;
  for(let i=0;i<200;i++){if(Number(await sql("SELECT count(*) FROM pg_stat_activity WHERE datname='coast_runtime_external' AND wait_event='advisory'",socket,'postgres','postgres'))>0){blocked=true;break;}await Bun.sleep(20);}
  assert(blocked,'queue claim did not block before outage');
  external.kill('SIGINT');await exit(external,0);
  assert(await holder.exited!==0,'queue lock holder was not cancelled');
  assert(await health()===503&&outage.child.exitCode===null,'external outage incorrectly healthy or killed frontend');
  await Bun.sleep(2000);
  assert(await health()===503&&outage.child.exitCode===null,'external outage retry killed frontend or reported healthy');
  external=spawn(pgArgs,'external-db-restarted');await ready(outage.child);
  outage.child.kill('SIGTERM');await exit(outage.child,143);
  assert(await sql('SELECT 1',socket,'postgres','postgres')==='1','frontend stopped an external server');
  console.log('external outage: unavailable503, recovery200 in same frontend, external process not owned by frontend');
  const offlineStop=start('external-offline-stop',{DATABASE_URL:'postgresql://postgres@127.0.0.1:5432/coast_runtime_external'});await ready(offlineStop.child);
  external.kill('SIGINT');await exit(external,0);
  assert(await health()===503&&offlineStop.child.exitCode===null,'offline-stop fixture was not unavailable and alive');
  offlineStop.child.kill('SIGTERM');await exit(offlineStop.child,143);
  assert(!(await rows(offlineStop.data,'shutdown-events')).some(r=>r.detail.child==='database'),'external outage attempted bundled database cleanup');
  console.log('external outage shutdown: status143 within bound while SQL connections are unavailable');
  console.log('DISPOSABLE_REAL_RUNTIME_PASSED');
} finally {
  for(const pid of frozenPids){try{process.kill(pid,'SIGCONT');}catch{}}
  for(const child of children)if(child.exitCode===null){try{process.kill(-child.pid,'SIGCONT');}catch{}child.kill('SIGTERM');}
  await Promise.all(children.filter(c=>c.exitCode===null).map(async child=>{await Promise.race([child.exited,Bun.sleep(3000)]);if(child.exitCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}}));
}
