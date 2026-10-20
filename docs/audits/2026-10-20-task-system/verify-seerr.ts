import assert from 'node:assert/strict';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {getSeerr} from '../../../src/lib/providers/seerr/connection.server';
import {refreshRequests} from '../../../src/lib/providers/seerr/requests.server';
import {pruneTransientRecords} from '../../../src/lib/server/storage/retention.server';
import {jobExecution,JobYield} from '../../../src/lib/server/queue/execution';
const sql=getSql(),report:any={boundary:'Existing actual admin Seerr account and real provider GET responses, controlled task cursor/age on the disposable catalogue copy. No provider writes, fabricated account/catalogue/response or normal/live task changes.',cases:[]};
try{
 assert.equal((await sql`select current_database() name`)[0].name,'coast_reading_audit_tasks_20261020');
 const [admin]=await sql`select id from users where username='admin' and role='admin' and not disabled`;assert(admin);
 const [link]=await sql`select c.* from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${admin.id} and i.provider='seerr' and c.status='connected' limit 1`;assert(link);
 const context=await getSeerr(admin.id,link.instance_id,{connectionId:link.id,accountGeneration:link.account_generation});
 const page=await context.adapter.requests(0,false,context.account);assert(page.results.length>0,'Natural nonempty real request page absent; do not manufacture it.');
 const [job]=await sql`select id from outbox_actions where user_id=${admin.id} and connection_id=${link.id} and kind='seerr.sync' order by created_at limit 1`;assert(job);
 const scanId=crypto.randomUUID(),point={task:'seerr-sync',scanId,phase:'scanning',offset:0,next:1,after:null};
 await sql`update outbox_actions set state='running',attempts=attempts+1,payload=jsonb_set(payload,'{_checkpoint}',${point}::jsonb,true),locked_at=now() where id=${job.id}`;
 const execute=async()=>{const [j]=await sql`select payload,attempts from outbox_actions where id=${job.id}`;return jobExecution.run({id:job.id,userId:admin.id,kind:'seerr.sync',payload:j.payload,attempts:j.attempts,purpose:'scheduled',started:performance.now()-10001,checkpoints:0},()=>refreshRequests(admin.id,link.instance_id,{connectionId:link.id,accountGeneration:link.account_generation}));};
 await assert.rejects(execute,cause=>cause instanceof JobYield);
 const [saved]=await sql`select payload->'_checkpoint' point from outbox_actions where id=${job.id}`;assert.notEqual(saved.point.scanId,scanId);
 report.cases.push({name:'A missing partial-page snapshot restarts a fresh real Seerr census and reaches a bounded checkpoint',status:'passed',realPageRows:page.results.length});
 // Retention receives the exact real response, wrapped in the existing persisted-page contract.
 const data={task:'seerr-sync-page',scanId:saved.point.scanId,offset:0,results:page.results};
 await sql`delete from provider_job_snapshots where action_id=${job.id}`;
 await sql`insert into provider_job_snapshots(action_id,connection_id,account_generation,data,updated_at) values(${job.id},${link.id},${link.account_generation},${data}::jsonb,now()-interval '40 days')`;
 for(const state of ['pending','failed']){await sql`update outbox_actions set state=${state} where id=${job.id}`;await pruneTransientRecords();assert.equal((await sql`select count(*)::int n from provider_job_snapshots where action_id=${job.id}`)[0].n,1);}
 await sql`update outbox_actions set state='succeeded' where id=${job.id}`;await pruneTransientRecords();assert.equal((await sql`select count(*)::int n from provider_job_snapshots where action_id=${job.id}`)[0].n,0);
 report.cases.push({name:'Aged real response snapshot survives pending/failed recovery and expires only after success',status:'passed'});report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}finally{await closeDb();await Bun.write('/private/tmp/coast-task-seerr-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
