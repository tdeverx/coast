import assert from 'node:assert/strict';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {listTaskActions} from '../../../src/lib/server/queue';
import {dependencyScopeSql} from '../../../src/lib/server/queue/dependencies';
import {jobTaskSections,jobAttentionCount,taskJobCount} from '../../../src/lib/ui/queue';
import {baselineModule} from './baseline-module';
const sql=getSql(),frozen=await baselineModule('src/lib/server/queue/index.ts');
const report:any={boundary:'Controlled scheduling/failure states on existing real admin tasks in the approved disposable catalogue. Failure context/attempt count comes from captured actual IGDB metadata; no fabricated provider response or dispatch.',cases:[]};
try{
 assert.equal((await sql`select current_database() name`)[0].name,'coast_reading_audit_tasks_20261020');
 const [user]=await sql`select id,username,role,settings from users where username='admin' and role='admin' and not disabled`;assert(user);const actor={...user,email:null};
 const [link]=await sql`select c.* from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${user.id} and i.provider='seerr' and c.status='connected' limit 1`;assert(link);
 const rows=await sql`select id from outbox_actions where user_id=${user.id} and connection_id=${link.id} and kind='seerr.sync' and account_generation=${link.account_generation} order by created_at limit 2`;assert.equal(rows.length,2);
 const evidence=await Bun.file(process.cwd()+'/.data/task-audit-20261020/readonly-task-evidence.private.json').json();
 const failed=evidence.representatives.find((job:any)=>job.kind==='igdb.steam-metadata'&&job.attempts===57);assert(failed?.failure);
 await sql`update outbox_actions set state='cancelled' where kind='seerr.sync' and connection_id in(select id from provider_connections where instance_id=${link.instance_id})`;
 await sql`update outbox_actions set state='pending',attempts=0,payload=(payload-'_jobFailure')||'{"_manual":true}'::jsonb,next_attempt_at=now() where id=${rows[0].id}`;
 await sql`update outbox_actions set state='pending',attempts=${failed.attempts},payload=payload||${{_manual:true,_jobFailure:failed.failure}}::jsonb,next_attempt_at=now()+interval '1 hour' where id=${rows[1].id}`;
 const task=(jobs:any[])=>jobs.filter(job=>job.kind==='seerr.sync'&&job.instanceId===link.instance_id);
 const original=task(await frozen.module.listTaskActions(actor));assert.equal(original.find(job=>job.state==='pending')?.id,rows[0].id);assert.equal(jobTaskSections([{jobs:original}]).attention.length,0);
 report.cases.push({name:'Original fresh eligible representative hides an actual-job sustained retry in backoff',status:'reproduced'});
 const current=task(await listTaskActions(actor)),pending=current.find(job=>job.state==='pending');assert(pending);assert.equal(pending.id,rows[1].id);assert.equal(pending.attentionCount,1);assert.equal(jobAttentionCount(pending),1);assert.equal(taskJobCount(current,'pending'),2);
 const entry={jobs:current};assert(jobTaskSections([entry]).attention.includes(entry));
 assert.equal((await sql`select state from outbox_actions where id=${rows[0].id}`)[0].state,'pending');
 report.cases.push({name:'Aggregate attention and failing representative preserve two pending jobs but report exactly one needing attention',status:'passed',pending:2,attention:1});
 // UUID spelling must not split one actual work into different conflict keys.
 const cases=await sql.unsafe(`with original as(select kind,payload,user_id,connection_id from outbox_actions where user_id=$1 and kind='jellyfin.user-state' and payload->>'mediaId' is not null limit 10)
   select count(*)::int checked,count(*) filter(where (${dependencyScopeSql('lower_action')}) is distinct from (${dependencyScopeSql('upper_action')}))::int mismatches
   from original o cross join lateral(select o.kind,o.user_id,o.connection_id,o.payload||jsonb_build_object('mediaId',lower(o.payload->>'mediaId')) payload) lower_action
   cross join lateral(select o.kind,o.user_id,o.connection_id,o.payload||jsonb_build_object('mediaId',upper(o.payload->>'mediaId')) payload) upper_action`,[user.id]);
 assert(cases[0].checked>0);assert.equal(cases[0].mismatches,0);report.cases.push({name:'Equivalent UUID spellings retain the same dependency identity on actual admin work references',status:'passed',...cases[0]});report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}finally{await frozen.cleanup();await closeDb();await Bun.write('/private/tmp/coast-task-attention-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
