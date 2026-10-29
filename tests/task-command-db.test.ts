import {afterAll,beforeAll,expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {updateTaskActions,readTaskCommand,resumeTaskCommand,abandonTaskCommand,listTaskCommands} from '../src/lib/server/queue/task-commands.server';
import {pruneTransientRecords} from '../src/lib/server/storage/retention.server';
import type {SessionUser} from '../src/lib/server/auth';
import {registerJobRequestPriority,releaseJobRequestPriority,currentRequestPriority,requestPriority,providerJob} from '../src/lib/server/security/request-priority';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const actor:SessionUser={id:crypto.randomUUID(),username:'bulk-command',role:'admin',email:null,settings:{}};
const other={...actor,id:crypto.randomUUID(),username:'other-command'};
const spec={kind:'test.command',instanceId:null,action:'cancel' as const};
async function jobs(n:number,kind=spec.kind){const sql=getSql(),ids=Array.from({length:n},()=>crypto.randomUUID()).sort();for(const id of ids)await sql`insert into outbox_actions(id,user_id,kind,state,payload,created_at) values(${id},${actor.id},${kind},'pending','{}',now()-interval '1 day')`;return ids;}
async function clear(){const sql=getSql();await sql`delete from outbox_actions where user_id=${actor.id}`;await sql`delete from task_control_commands where actor_id=${actor.id}`;}
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;const sql=getSql();for(const a of [actor,other])await sql`insert into users(id,username,role) values(${a.id},${a.username},'admin')`;});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await getSql()`delete from users where id in (${actor.id},${other.id})`;});
run('exact 100-job admission, later arrivals and response-loss replay preserve original effects',async()=>{
 await clear();const sql=getSql(),ids=await jobs(101),id=crypto.randomUUID();
 const admitted=await updateTaskActions(actor,spec.kind,null,'cancel',id);expect(admitted).toMatchObject({total:100,updated:0,status:'incomplete',hasMore:true});
 expect((await sql`select state from outbox_actions where user_id=${actor.id} and state='pending'`).length).toBe(101);
 const later=await jobs(1);const done=await resumeTaskCommand(actor,id,admitted.revision);
 expect(done).toMatchObject({status:'complete',updated:100,skipped:0,remaining:0});
 expect(await resumeTaskCommand(actor,id,0)).toEqual(done);
 expect(await updateTaskActions(actor,spec.kind,null,'cancel',id)).toEqual(done);
 const cancelled=await sql<{id:string}[]>`select id from outbox_actions where user_id=${actor.id} and state='cancelled' order by id`;
 expect(cancelled.map(x=>x.id)).toEqual(ids.slice(0,100));expect((await sql`select state from outbox_actions where id=${later[0]}`)[0].state).toBe('pending');
});
run('receipt failure rolls back the native effect and notification, then resumes the committed prefix',async()=>{
 await clear();const sql=getSql(),ids=await jobs(4),c=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());
 await sql`insert into notifications(user_id,kind,title,source_key) values(${actor.id},'external-action','Receipt boundary',${'outbox:'+ids[2]})`;
 await sql.unsafe(`create function test_command_receipt_fail() returns trigger language plpgsql as $$begin if new.updated=3 then raise exception 'native receipt fault'; end if; return new; end$$;create trigger test_command_receipt_fail before update on task_control_commands for each row execute function test_command_receipt_fail()`);
 try{await expect(resumeTaskCommand(actor,c.id,0)).rejects.toThrow('native receipt fault');}finally{await sql.unsafe('drop trigger test_command_receipt_fail on task_control_commands;drop function test_command_receipt_fail()');}
 expect((await readTaskCommand(actor,c.id)).updated).toBe(2);
 expect((await sql`select state from outbox_actions where id=${ids[2]}`)[0].state).toBe('pending');
 expect(await sql`select id from notifications where source_key=${'outbox:'+ids[2]}`).toHaveLength(1);
 const done=await resumeTaskCommand(actor,c.id,2);expect(done.updated).toBe(4);expect(done.status).toBe('complete');
});
run('unexpected native target errors retain the exact prefix and require a fresh explicit revision',async()=>{
 await clear();const sql=getSql(),ids=await jobs(4),c=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());
 await sql.unsafe(`create function test_command_effect_fail() returns trigger language plpgsql as $$begin if new.id='${ids[2]}'::uuid then raise exception 'native target fault'; end if;return new;end$$;create trigger test_command_effect_fail before update on outbox_actions for each row execute function test_command_effect_fail()`);
 let failed;try{failed=await resumeTaskCommand(actor,c.id,0);expect(failed).toMatchObject({updated:2,remaining:2,status:'incomplete'});expect(failed.error).toContain('interrupted');expect(await resumeTaskCommand(actor,c.id,0)).toEqual(failed);}finally{await sql.unsafe('drop trigger test_command_effect_fail on outbox_actions;drop function test_command_effect_fail()');}
 expect((await resumeTaskCommand(actor,c.id,failed!.revision)).status).toBe('complete');
});
run('duplicate continuations and changed targets cannot duplicate counts or skip unseen work',async()=>{
 await clear();const sql=getSql(),ids=await jobs(12),c=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());
 await sql`update outbox_actions set state='running' where id=${ids[5]}`;
 await Promise.all([resumeTaskCommand(actor,c.id,0),resumeTaskCommand(actor,c.id,0)]);
 let current=await readTaskCommand(actor,c.id);if(current.status==='incomplete')current=await resumeTaskCommand(actor,c.id,current.revision);
 expect(current).toMatchObject({updated:11,skipped:1,total:12,status:'complete'});
});
run('foreign ownership, changed specification and revoked administrator authority deny continuation',async()=>{
 await clear();await jobs(1);const c=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());
 await expect(readTaskCommand(other,c.id)).rejects.toMatchObject({status:404});
 await expect(updateTaskActions(actor,spec.kind,null,'retry',c.id)).rejects.toMatchObject({status:409});
 const sql=getSql();await sql`update users set role='user' where id=${actor.id}`;
 try{await expect(resumeTaskCommand(actor,c.id,0)).rejects.toMatchObject({status:403});}finally{await sql`update users set role='admin' where id=${actor.id}`;}
 expect((await readTaskCommand(actor,c.id)).updated).toBe(0);
});
run('abandoning unknown admission seals the identity against delayed requests',async()=>{
 await clear();await jobs(1);const id=crypto.randomUUID();const result=await abandonTaskCommand(actor,id,spec);
 expect(result.status).toBe('abandoned');expect(await updateTaskActions(actor,spec.kind,null,'cancel',id)).toEqual(result);expect(await resumeTaskCommand(actor,id,0)).toEqual(result);
 expect((await listTaskCommands(actor)).items.some(x=>x.id===id)).toBe(true);
});
run('30-day terminal compaction keeps replay identity and never expires unfinished commands or job history',async()=>{
 await clear();const sql=getSql();await jobs(2);const done=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());await resumeTaskCommand(actor,done.id,0);
 await jobs(1);const open=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());
 await sql`update task_control_commands set updated_at=now()-interval '40 days' where id in (${done.id},${open.id})`;
 const young=await updateTaskActions(actor,'test.young',null,'cancel',crypto.randomUUID());
 await sql`update task_control_commands set updated_at=now()-interval '29 days' where id=${young.id}`;
 const abandoned=await abandonTaskCommand(actor,crypto.randomUUID(),spec);
 await sql`update task_control_commands set updated_at=now()-interval '31 days' where id=${abandoned.id}`;
 const before=await readTaskCommand(actor,done.id);await pruneTransientRecords();
 expect(await readTaskCommand(actor,done.id)).toEqual({...before,compacted:true});
 expect((await readTaskCommand(actor,open.id)).compacted).toBe(false);
 expect((await readTaskCommand(actor,young.id)).compacted).toBe(false);
 const compactAbandoned=await readTaskCommand(actor,abandoned.id);expect(compactAbandoned.compacted).toBe(true);
 expect(await updateTaskActions(actor,spec.kind,null,'cancel',abandoned.id)).toEqual(compactAbandoned);
 const [row]=await sql`select target_ids,outcomes from task_control_commands where id=${done.id}`;expect(row).toEqual({target_ids:null,outcomes:null});
 expect((await updateTaskActions(actor,spec.kind,null,'cancel',done.id)).updated).toBe(2);
 expect(await sql`select id from outbox_actions where user_id=${actor.id}`).toHaveLength(3);
});
run('empty admission is durably complete without a target mutation',async()=>{
 await clear();const result=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());expect(result).toMatchObject({status:'complete',total:0,updated:0,skipped:0});
});
run('promotion replay reconstructs active urgency without resetting retry credit or service gates',async()=>{
 await clear();const sql=getSql(),[id]=await jobs(1),next=new Date(Date.now()+3600000);
 await sql`update outbox_actions set state='running',attempts=7,next_attempt_at=${next},payload='{"_jobPurpose":"scheduled","_webhookAttemptBase":4}'::jsonb where id=${id}`;
 const c=await updateTaskActions(actor,spec.kind,null,'promote',crypto.randomUUID());
 registerJobRequestPriority(id,3);
 const priority=()=>requestPriority.run(3,()=>providerJob.run(id,currentRequestPriority));
 try{
  expect(priority()).toBe(3);const done=await resumeTaskCommand(actor,c.id,0);expect(done.updated).toBe(1);expect(priority()).toBe(1);
  releaseJobRequestPriority(id);registerJobRequestPriority(id,3);
  expect(await resumeTaskCommand(actor,c.id,0)).toEqual(done);expect(priority()).toBe(1);
  const [row]=await sql`select state,attempts,next_attempt_at,payload from outbox_actions where id=${id}`;
  expect(row).toMatchObject({state:'running',attempts:7,payload:{_jobPurpose:'manual',_webhookAttemptBase:4}});expect(new Date(row.next_attempt_at).getTime()).toBe(next.getTime());
 }finally{releaseJobRequestPriority(id);}
});
run('an already paused continuation cannot mutate its first target',async()=>{
 await clear();await jobs(1);const c=await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID());
 const controller=new AbortController();controller.abort();expect(await resumeTaskCommand(actor,c.id,0,controller.signal)).toEqual(c);
});
run('unfinished discovery is bounded and explicit abandonment exposes the next original command',async()=>{
 await clear();await jobs(1);const commands:Awaited<ReturnType<typeof updateTaskActions>>[]=[];
 for(let i=0;i<101;i++)commands.push(await updateTaskActions(actor,spec.kind,null,'cancel',crypto.randomUUID()));
 const first=await listTaskCommands(actor);expect(first.more).toBe(true);expect(first.items.filter(x=>x.status==='incomplete')).toHaveLength(100);
 expect(first.items.some(x=>x.id===commands[100].id)).toBe(false);
 await abandonTaskCommand(actor,commands[0].id,spec);
 const next=await listTaskCommands(actor);expect(next.more).toBe(false);expect(next.items.filter(x=>x.status==='incomplete')).toHaveLength(100);expect(next.items.some(x=>x.id===commands[100].id)).toBe(true);
});
