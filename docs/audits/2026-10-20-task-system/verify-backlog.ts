import assert from 'node:assert/strict';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {queueSelectionSql} from '../../../src/lib/server/queue';
import {queueOrderCteSql,dependencyScopeSql} from '../../../src/lib/server/queue/dependencies';
import {maintenanceKinds,serviceTraversalKinds} from '../../../src/lib/providers/tasks';
const root=process.cwd(),base=process.env.COAST_TASK_AUDIT_DATA??root+'/.data/task-audit-20261020/';
const report:any={boundary:'Exact approved live task/connection/instance rows in temporary shadow tables on the disposable catalogue copy. No users, credentials or provider dispatch. Controlled developerMode=false on both sides. Missing live playback/checkpoint parents are not imported; scrobble scopes stay conservative. Read-only selection analogue, not claim/recovery cost.',cases:[]};
const source=await Bun.file(root+'/src/lib/server/queue/index.ts').text();
const fragment=source.slice(source.indexOf('const independentQueueKinds='),source.indexOf('export class PermanentActionError'));
const owner=new Function('maintenanceKinds','serviceTraversalKinds','dependencyScopeSql','queueOrderCteSql',new Bun.Transpiler({loader:'ts'}).transformSync(fragment.replace('export function queueSelectionSql','function queueSelectionSql'))+';return {independentQueueKinds,automaticQueueKinds,accountOrderBlockerSql};')(maintenanceKinds,serviceTraversalKinds,dependencyScopeSql,queueOrderCteSql);
const actions=await Bun.file(base+'outbox-implementation.private.json').json(),connections=await Bun.file(base+'connection-state-implementation.private.json').json(),instances=await Bun.file(base+'instance-state-implementation.private.json').json();
const generated=Bun.spawnSync([process.execPath,'docs/audits/2026-10-20-task-system/selection-sql.ts','9575de2']);assert.equal(generated.exitCode,0);const baseline=JSON.parse(new TextDecoder().decode(generated.stdout));
try{await getSql().begin(async tx=>{
 const [db]=await tx`select current_database() name`;assert.equal(db.name,'coast_reading_audit_tasks_20261020');
 await tx`set local statement_timeout='25s'`;
 await tx`create temporary table outbox_actions (like public.outbox_actions including defaults including indexes) on commit drop`;
 await tx`create temporary table provider_connections on commit drop as select id,user_id,instance_id,account_generation,status,external_user_id,settings from public.provider_connections where false`;
 await tx`create temporary table provider_instances on commit drop as select id,provider,enabled,settings from public.provider_instances where false`;
 await tx`create temporary table system_settings on commit drop as select key,value from public.system_settings where false`;
 await tx`insert into system_settings values('coast','{"developerMode":false}'::jsonb)`;
 for(const [table,rows] of [['provider_connections',connections],['provider_instances',instances],['outbox_actions',actions]] as const){
  for(let start=0;start<rows.length;start+=500)await tx.unsafe(`insert into ${table} select * from jsonb_populate_recordset(null::${table},$1::jsonb)`,[rows.slice(start,start+500)]);
  await tx.unsafe('analyze '+table);
 }
 const cte=queueOrderCteSql(owner.independentQueueKinds,owner.automaticQueueKinds);
 const actual=await tx.unsafe(cte+` select a.id,a.user_id,a.connection_id,a.created_at,to_char(a.created_at,'YYYY-MM-DD HH24:MI:SS.US') created_order,a.state,a.effect_scope,b.blocking_id from queue_scopes a join queue_blockers b using(id)`);
 const lanes=new Map<string,any[]>();for(const a of actual){const key=a.user_id+':'+a.connection_id;const lane=lanes.get(key)??[];lane.push(a);lanes.set(key,lane);}
 let compared=0,blocked=0,observationsPassing=0,unrelatedPassing=0,sameEffectBlocked=0;
 for(const lane of lanes.values()){
  lane.sort((a,b)=>a.created_order.localeCompare(b.created_order)||a.id.localeCompare(b.id));
  for(let index=0;index<lane.length;index++){
   const a=lane[index],earlier=lane.slice(0,index);
   const expected=lane.some(b=>b.state==='running'&&b.id!==a.id)||a.effect_scope!==null&&earlier.some(b=>b.effect_scope!==null&&(a.effect_scope==='*'||b.effect_scope==='*'||a.effect_scope===b.effect_scope));
   if((a.blocking_id!==null)!==Boolean(expected)){const heads=await tx.unsafe(cte+' select * from queue_heads where id=$1',[a.id]);await Bun.write('/private/tmp/coast-task-window-mismatch.private.json',JSON.stringify({a,heads,earlier:earlier.filter(b=>b.effect_scope!==null).slice(0,3)},null,2));console.log('Mismatch saved privately; actual kind',actions.find((r:any)=>r.id===a.id)?.kind);}
   assert.equal(a.blocking_id!==null,Boolean(expected),'CTE disagrees with ordered real-row reference');compared++;if(expected)blocked++;
   if(earlier.length&&!expected){if(a.effect_scope===null)observationsPassing++;else unrelatedPassing++;}
   if(expected&&earlier.some(b=>b.effect_scope===a.effect_scope))sameEffectBlocked++;
  }
 }
 report.cases.push({name:'All scoped active rows agree with independent ordered real-row reference',status:'passed',compared,blocked,observationsPassing,unrelatedPassing,sameEffectBlocked});
 const scalar=owner.accountOrderBlockerSql('a');
 const sample=await tx.unsafe(cte+` select count(*)::int checked,count(*) filter(where (b.blocking_id is not null) is distinct from ((${scalar}) is not null))::int mismatches from (select o.* from outbox_actions o join queue_scopes s on s.id=o.id order by s.state,s.effect_scope nulls first,s.created_at,s.id limit 250) a join queue_blockers b using(id)`);
 assert.equal(sample[0].mismatches,0);report.cases.push({name:'Presentation scalar and worker CTE parity on 250 actual representatives',status:'passed',...sample[0]});
 await tx`savepoint running_case`;
 await tx.unsafe(cte+` update outbox_actions o set state='running' where o.id in(select distinct on(user_id,connection_id) id from queue_scopes order by user_id,connection_id,created_at,id)`);
 const runningCheck=await tx.unsafe(cte+` select count(*)::int scoped,count(*) filter(where a.state='running')::int running,count(*) filter(where a.state<>'running' and b.blocking_id is null)::int escaped from queue_scopes a join queue_blockers b using(id)`);
 assert(runningCheck[0].running>0);assert.equal(runningCheck[0].escaped,0);report.cases.push({name:'Controlled running actual jobs exclude every other scoped job in their account lanes',status:'passed',...runningCheck[0]});
 await tx`rollback to savepoint running_case`;
 await tx`savepoint generation_case`;
 await tx`update provider_connections set account_generation=gen_random_uuid()`;
 const [stale]=await tx.unsafe(cte+` select count(*)::int retained from queue_scopes a join outbox_actions o using(id) where o.connection_id is not null and o.account_generation is not null`);
 assert.equal(stale.retained,0);report.cases.push({name:'Controlled account replacement excludes every revoked-generation actual task from dependency heads',status:'passed',...stale});
 await tx`rollback to savepoint generation_case`;
 await tx`savepoint pause_case`;
 await tx`update system_settings set value='{"developerMode":true}'::jsonb where key='coast'`;
 const [paused]=await tx.unsafe(cte+` select count(*)::int leaked from queue_scopes s join outbox_actions o using(id) where o.state<>'running' and o.kind in (${owner.automaticQueueKinds.map((kind:string)=>"'"+kind+"'").join(',')}) and coalesce(o.payload->>'_manual','false')<>'true'`);
 assert.equal(paused.leaked,0);report.cases.push({name:'Developer pause excludes automatic actual backlog rows without manual intent',status:'passed',...paused});
 await tx`rollback to savepoint pause_case`;
 const locked=await tx.unsafe(queueSelectionSql(false,true));assert.equal(locked.length,1);report.cases.push({name:'Candidate row-locking selector executes on the actual temporary backlog',status:'passed',selected:locked.length});
 const measure=async(label:string,query:string,runs:number)=>{
  const values=[];for(let n=0;n<runs;n++){
   const result=await tx.unsafe('explain (analyze,buffers,format json) '+query),p=result[0]['QUERY PLAN'][0];await Bun.write('/private/tmp/coast-task-plan-'+label+'-'+n+'.json',JSON.stringify(p,null,2));values.push({executionMs:p['Execution Time'],sharedHits:p.Plan['Shared Hit Blocks'],sharedReads:p.Plan['Shared Read Blocks'],localHits:p.Plan['Local Hit Blocks'],localReads:p.Plan['Local Read Blocks'],tempReads:p.Plan['Temp Read Blocks'],tempWrites:p.Plan['Temp Written Blocks'],rows:p.Plan['Actual Rows']});
   console.log(label,n,JSON.stringify(values.at(-1)));
  }return values;
 };
 // Every probe runs in the same transaction, database pool/JIT, row snapshot and settings.
 if(process.env.COAST_AUDIT_CORRECTNESS_ONLY!=='1'){await measure('warmup-original',baseline.claim,1);await measure('warmup-candidate',queueSelectionSql(),1);
 report.baseline=[];report.candidate=[];
 for(let round=0;round<3;round++){report.baseline.push(...await measure('original-'+round,baseline.claim,1));report.candidate.push(...await measure('candidate-'+round,queueSelectionSql(),1));}
 }report.rows=actions.length;report.status='passed';
});}catch(error){report.status='failed';report.failure=String(error);throw error;}finally{await closeDb();await Bun.write(process.env.COAST_AUDIT_RESULT??'/private/tmp/coast-task-backlog-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
