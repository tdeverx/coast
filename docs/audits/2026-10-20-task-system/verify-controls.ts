import assert from 'node:assert/strict';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {updateTaskActions} from '../../../src/lib/server/queue';
const sql=getSql(),report:any={boundary:'Controlled states on existing actual admin Seerr task rows in the approved disposable catalogue copy. No fabricated users/media/jobs/provider responses; no worker or provider dispatch.',cases:[]};
try{
 assert.equal((await sql`select current_database() name`)[0].name,'coast_reading_audit_tasks_20261020');
 const [user]=await sql`select * from users where username='admin' and role='admin' and not disabled`;assert(user);
 const actor={id:user.id,username:user.username,role:user.role,email:null,settings:user.settings};
 const [connection]=await sql`select c.* from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${user.id} and i.provider='seerr' and c.status='connected' limit 1`;assert(connection);
 const rows=await sql`select * from outbox_actions where user_id=${user.id} and connection_id=${connection.id} and kind='seerr.sync' and account_generation=${connection.account_generation} order by created_at,id limit 202`;assert.equal(rows.length,202);
 const ids=rows.map(r=>r.id),running=ids.at(-1);
 const [history]=await sql`select md5(coalesce(jsonb_agg(t order by t.id)::text,'')) value from tracking_events t where user_id=${user.id}`;
 await sql`update outbox_actions set state='cancelled' where kind='seerr.sync' and connection_id=${connection.id}`;
 await sql`update outbox_actions set state='pending',payload=payload||'{"_jobPurpose":"scheduled","_manual":false}'::jsonb where id=any(${sql.array(ids,'UUID')})`;
 await sql`update outbox_actions set state='running',locked_at=now() where id=${running}`;
 const promoted=[];for(let i=0;i<3;i++)promoted.push(await updateTaskActions(actor,'seerr.sync',connection.instance_id,'promote'));
 assert.deepEqual(promoted.map(r=>r.updated),[100,100,2]);assert.deepEqual(promoted.map(r=>r.hasMore),[true,true,false]);
 const noMore=await updateTaskActions(actor,'seerr.sync',connection.instance_id,'promote');assert.equal(noMore.updated,0);
 const unchanged=await sql`select id,state,attempts,next_attempt_at,payload from outbox_actions where id=any(${sql.array(ids,'UUID')})`;
 for(const row of unchanged){const before=rows.find(r=>r.id===row.id)!;assert.equal(row.attempts,before.attempts);assert.equal(row.next_attempt_at.getTime(),before.next_attempt_at.getTime());const strip=(p:any)=>{const {_jobPurpose,_manual,...rest}=p;return rest;};assert.deepEqual(strip(row.payload),strip(before.payload));}
 report.cases.push({name:'Bounded promotion advances 100/100/2, preserves original retry deadlines/attempts/checkpoints and becomes empty on replay',status:'passed',batches:promoted});
 const cancelled=[];for(let i=0;i<3;i++)cancelled.push(await updateTaskActions(actor,'seerr.sync',connection.instance_id,'cancel'));
 assert.deepEqual(cancelled.map(r=>r.updated),[100,100,1]);assert.deepEqual(cancelled.map(r=>r.hasMore),[true,true,false]);
 assert.equal((await sql`select state from outbox_actions where id=${running}`)[0].state,'running');
 const [after]=await sql`select md5(coalesce(jsonb_agg(t order by t.id)::text,'')) value from tracking_events t where user_id=${user.id}`;assert.equal(after.value,history.value);
 report.cases.push({name:'Bounded cancellation advances 100/100/1, retains actual running job and leaves personal history unchanged',status:'passed',batches:cancelled});
 // Reuse a second genuine historical account/job in the same actual service.
 const [other]=await sql`select a.id,a.user_id,a.connection_id,a.account_generation from outbox_actions a join provider_connections c on c.id=a.connection_id
   where a.kind='seerr.sync' and c.instance_id=${connection.instance_id} and c.id<>${connection.id} and a.account_generation=c.account_generation order by a.created_at limit 1`;
 assert(other,'A second actual account task is required; do not manufacture one.');
 await sql`update outbox_actions set state='failed',created_at=(select min(created_at)-interval '1 second' from outbox_actions) where id=any(${sql.array(ids.slice(0,-1),'UUID')})`;
 await sql`update outbox_actions set state='cancelled' where kind='seerr.sync' and connection_id=${other.connection_id} and state in ('pending','running','failed')`;
 await sql`update outbox_actions set state='failed' where id=${other.id}`;
 const retried=await updateTaskActions(actor,'seerr.sync',connection.instance_id,'retry');
 assert.equal(retried.updated,1);assert.equal(retried.blocked,true);assert.equal(retried.hasMore,false);
 assert.equal((await sql`select state from outbox_actions where id=${other.id}`)[0].state,'pending');
 const [held]=await sql`select count(*)::int n from outbox_actions where id=any(${sql.array(ids.slice(0,-1),'UUID')}) and state='failed'`;assert.equal(held.n,201);
 report.cases.push({name:'201 older blocked actual failures do not consume the retry batch; another real account advances and blocked state is reported',status:'passed',updated:retried.updated,blockedFailuresRetained:held.n,blocked:retried.blocked});report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);throw error;}finally{await closeDb();await Bun.write('/private/tmp/coast-task-controls-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
