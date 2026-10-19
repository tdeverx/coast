import {expect,test} from 'bun:test';

// Module mocks and fake timers live in a child process, isolated from all other suites.
// The child imports the complete real maintenance module; only external boundaries are mocked.
test('stalled shared cleanup never delays ordinary maintenance and timer ticks coalesce both passes',async()=>{
 const root=new URL('../',import.meta.url).pathname;
 const source=`
import {mock} from 'bun:test';
const root=${JSON.stringify(root)},lib=root+'src/lib/';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const cleanupGate=deferred(),scheduleGate=deferred(),avatarGate=deferred();
let avatars=0,avatarStopped=false;
let cleanup=0,schedules=0,retention=0,developerMode=false,timer,cleared=false,logs=[];
let cleanupResult=()=>cleanupGate.promise;
const check=(condition,detail)=>{if(!condition)throw new Error(detail+' '+JSON.stringify({cleanup,schedules,retention}));};
const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
mock.module(lib+'core/profile/avatar-storage.server.ts',()=>({pruneUnusedAvatars:()=>{avatars++;return avatarGate.promise;},stopAvatarSweep:async()=>{avatarStopped=true;avatarGate.resolve({scanned:0,removed:0,skipped:0,more:false});}}));
mock.module(lib+'sharing/leases.server.ts',()=>({expireSharedViewers:()=>{cleanup++;return cleanupResult();}}));
mock.module(lib+'server/storage/retention.server.ts',()=>({pruneTransientRecords:async()=>{retention++;return {busy:false,removed:0,expired:0,more:false};}}));
mock.module(lib+'server/config.ts',()=>({getConfig:async()=>({developerMode})}));
mock.module(lib+'server/diagnostics/runtime.ts',()=>({runtimeEvidence:{track:(_stage,operation)=>operation()}}));
mock.module(lib+'server/diagnostics/index.ts',()=>({context:{getStore:()=>null},logDiagnostic:async(...args)=>{logs.push(args);}}));
mock.module(lib+'providers/instances.server.ts',()=>({requireProviderAdmin:async()=>{},getInstance:async()=>({provider:'jellyfin'})}));
mock.module(lib+'server/db/index.ts',()=>({getDb:()=>({transaction:async()=>{schedules++;await scheduleGate.promise;return {queued:0,active:0,connections:0,busy:false};}}),getSql:()=>{throw new Error('Unexpected database access');},closeDb:async()=>{}}));
globalThis.setInterval=(callback,interval)=>{check(interval===60000,'wrong maintenance interval');timer=callback;return {unref(){}};};
globalThis.clearInterval=()=>{cleared=true;};
const maintenance=await import(lib+'providers/maintenance.server.ts');
try{
 maintenance.startProviderMaintenance();await settle();
 check(cleanup===1&&schedules===1&&retention===0,'startup scheduling waited for stalled cleanup');
 for(let i=0;i<5;i++)timer();await settle();
 check(cleanup===1&&schedules===1,'overlapping ticks duplicated a pending pass');
 scheduleGate.resolve();await settle();
 check(retention===1&&cleanup===1,'ordinary pass could not finish while cleanup was pending');
 timer();await settle();check(schedules===2&&cleanup===1,'later scheduling waited for cleanup');
 for(let i=0;i<5;i++)timer();await settle();
 check(schedules===3&&cleanup===1&&retention===1,'ticks failed to coalesce or retention lost its cadence');
 cleanupGate.resolve();await settle();timer();await settle();
 check(cleanup===2&&schedules===4,'completed cleanup did not permit a later bounded pass');
 developerMode=true;timer();await settle();
 check(cleanup===3&&schedules===4,'developer mode skipped cleanup or scheduled ordinary work');
 developerMode=false;cleanupResult=()=>Promise.reject(new Error('synthetic stop failure'));timer();await settle();
 check(cleanup===4&&schedules===5&&logs.some(row=>row[1]==='job.failed'),'cleanup failure blocked ordinary work or escaped logging');
 cleanupResult=()=>Promise.resolve();timer();await settle();
 check(cleanup===5&&schedules===6,'failed cleanup did not release its retry slot');
}finally{maintenance.stopProviderMaintenance();}
check(cleared,'maintenance timer was not stopped');
check(avatars===1&&avatarStopped,'avatar cleanup overlapped or failed to release its owner');
console.log(JSON.stringify({cleanup,schedules,retention,cleared}));
`;
 const child=Bun.spawn([process.execPath,'run','-'],{cwd:root,stdin:'pipe',stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0',COAST_PROVIDER_HTTP_TEST:'0'}});
 child.stdin.write(source);child.stdin.end();
 const [exitCode,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({exitCode,stderr}).toEqual({exitCode:0,stderr:''});
 expect(JSON.parse(stdout.trim())).toEqual({cleanup:5,schedules:6,retention:1,cleared:true});
});
