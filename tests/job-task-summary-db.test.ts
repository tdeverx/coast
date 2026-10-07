import {afterAll,beforeAll,expect,test} from 'bun:test';
import {getDb,getSql} from '../src/lib/server/db';
import {users,providerInstances,providerConnections,outboxActions} from '../src/lib/server/db/schema';
import {listTaskActions,updateTaskActions} from '../src/lib/server/queue';
import {taskJobCount,taskLastRun} from '../src/lib/ui/queue';
import type {SessionUser} from '../src/lib/server/auth';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const ids=Array.from({length:155},()=>crypto.randomUUID()),connections=ids.map(()=>crypto.randomUUID());
const instance=crypto.randomUUID(),other=crypto.randomUUID();
const actor:SessionUser={id:ids[0],username:'task-admin',role:'admin',email:null,settings:{}};
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 await getDb().insert(users).values(ids.map((id,index)=>({id,username:`summary-${id}`,role:index===0?'admin' as const:'user' as const})));
 await getDb().insert(providerInstances).values([instance,other].map(id=>({id,provider:'jellyfin' as const,name:'Task summary fixture',baseUrl:'https://fixture.invalid'})));
 await getDb().insert(providerConnections).values(connections.map((id,index)=>({id,userId:ids[index],instanceId:index===154?other:instance,status:'connected' as const,externalUserId:`user-${index}`})));
});
afterAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 await getSql()`delete from provider_instances where id in (${instance},${other})`;
 await getSql()`delete from users where id=any(${getSql().array(ids,'UUID')})`;
});
run('task totals cover queues larger than the individual display and return only representative jobs',async()=>{
 const db=getSql();
 await db`insert into outbox_actions(user_id,connection_id,account_generation,kind,state,payload)
 select user_id,id,account_generation,'jellyfin.sync','pending','{}'::jsonb from provider_connections where instance_id=${instance} and id=any(${db.array(connections.slice(0,150),'UUID')})`;
 const actions=(await listTaskActions(actor)).filter(job=>job.kind==='jellyfin.sync'&&job.instanceId===instance);
 expect(actions).toHaveLength(1);expect(taskJobCount(actions,'pending')).toBe(150);
 await db`delete from outbox_actions where kind='jellyfin.sync' and connection_id=any(${db.array(connections,'UUID')})`;
});
run('completed one-off tasks retain an old last result beyond the recent-history limit',async()=>{
 const db=getSql(),old=crypto.randomUUID();
 await db`insert into outbox_actions(id,user_id,kind,state,payload,updated_at) values(${old},${ids[0]},'webhook.deliver','succeeded','{"_jobOutcome":{"checked":1}}',now()-interval '400 days')`;
 await getDb().insert(outboxActions).values(Array.from({length:60},()=>({userId:ids[0],kind:'benchmark.run',state:'succeeded' as const,payload:{}})));
 const actions=await listTaskActions(actor),webhook=actions.filter(job=>job.kind==='webhook.deliver');
 expect(webhook).toHaveLength(1);expect(taskLastRun(webhook)?.id).toBe(old);
 expect(taskLastRun(webhook)?.outcome?.checked).toBe(1);expect(taskJobCount(webhook,'pending')).toBe(0);
 expect(actions.filter(job=>job.kind==='benchmark.run')).toHaveLength(1);
});
run('task retry can proceed beside another user and task cancellation retains running and unrelated work',async()=>{
 const db=getSql();
 const put=async(index:number,state:string)=>{
  const [row]=await db`insert into outbox_actions(user_id,connection_id,account_generation,kind,state,payload)
   select user_id,id,account_generation,'jellyfin.live',${state},'{}'::jsonb from provider_connections where id=${connections[index]} returning id`;
  return row.id as string;
 };
 const running=await put(150,'running'),failed=await put(151,'failed'),blocked=await put(152,'failed');
 await put(152,'pending');const unrelated=await put(154,'failed'),obsolete=await put(153,'failed');
 // Insert pins the current identity; a later reconnect makes the retained job obsolete.
 await db`update provider_connections set account_generation=${crypto.randomUUID()} where id=${connections[153]}`;
 await db`insert into notifications(user_id,kind,title,source_key) values(${ids[151]},'external-action','Fixture',${`outbox:${failed}`}),(${ids[152]},'external-action','Fixture',${`outbox:${blocked}`})`;
 await expect(listTaskActions({...actor,role:'user'})).rejects.toThrow('Administrator');
 await expect(updateTaskActions({...actor,role:'user'},'jellyfin.live',instance,'cancel')).rejects.toThrow('Administrator');
 const retried=await updateTaskActions(actor,'jellyfin.live',instance,'retry');
 expect((await db`select state from outbox_actions where id=${blocked}`)[0].state).toBe('failed');
 expect((await db`select state from outbox_actions where id=${unrelated}`)[0].state).toBe('failed');
 expect((await db`select state from outbox_actions where id=${obsolete}`)[0].state).toBe('failed');
 expect(retried).toEqual({updated:1,skipped:1});
 const summary=(await listTaskActions(actor)).filter(job=>job.kind==='jellyfin.live'&&job.instanceId===instance);
 expect(taskJobCount(summary,'running')).toBe(1);expect(taskJobCount(summary,'pending')).toBe(2);expect(taskJobCount(summary,'failed')).toBe(1);
 expect(await updateTaskActions(actor,'jellyfin.live',instance,'cancel')).toEqual({updated:3,skipped:0});
 const rows=await db<{id:string;state:string}[]>`select id,state from outbox_actions where id in (${running},${failed},${blocked},${unrelated},${obsolete})`;
 expect(rows.find(row=>row.id===running)?.state).toBe('running');
 expect(rows.find(row=>row.id===failed)?.state).toBe('cancelled');expect(rows.find(row=>row.id===blocked)?.state).toBe('cancelled');
 expect(rows.find(row=>row.id===unrelated)?.state).toBe('failed');expect(rows.find(row=>row.id===obsolete)?.state).toBe('failed');
 expect(await db`select id from notifications where source_key in (${`outbox:${failed}`},${`outbox:${blocked}`})`).toHaveLength(0);
});
