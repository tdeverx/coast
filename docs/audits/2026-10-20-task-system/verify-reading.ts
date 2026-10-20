import assert from 'node:assert/strict';
import {getSql,closeDb} from '../../../src/lib/server/db';
import {getJellyfin} from '../../../src/lib/providers/jellyfin/connection.server';
import {syncJellyfinUser,syncJellyfinChanges} from '../../../src/lib/sync/jellyfin.server';
import {jobExecution,JobYield} from '../../../src/lib/server/queue/execution';
import {baselineModule} from './baseline-module';
const frozen=await baselineModule('src/lib/sync/jellyfin.server.ts'),original=frozen.module;
const sql=getSql(),report:any={boundary:'Already approved actual-catalogue restore; actual connected admin/Jellyfin metadata. No provider writes or fake media/response payloads. Controlled screen gate only.',cases:[]};
try{
 const [database]=await sql`select current_database() as name`;assert.equal(database.name,'coast_reading_audit_tasks_20261020');
 const [admin]=await sql`select id from users where username='admin' and role='admin' and not disabled`;assert(admin);
 const [link]=await sql`select c.id from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${admin.id} and c.status='connected' and i.provider='jellyfin' and i.enabled order by c.id limit 1`;assert(link);
 const context=await getJellyfin(admin.id,link.id);
 const page=await context.adapter.readingPage(context.connection.externalUserId!);assert(page.items.length);
 const tasks=await Bun.file(process.cwd()+'/.data/task-audit-20261020/outbox-implementation.private.json').json();
 const hinted=[...new Set<string>(tasks.filter((a:any)=>a.kind==='jellyfin.delta'&&a.state==='failed').flatMap((a:any)=>a.payload.reading??[]))];
 let missing:string|undefined;
 for(const id of hinted){try{await context.adapter.readingItem(context.connection.externalUserId!,id);}catch(cause){if((cause as any).status===404||(cause as any).status===410){missing=id;break;}throw cause;}}
 assert(missing,'No naturally missing failed-hint reading file exists; do not invent one.');
 const available=page.items.find((book:any)=>book.Id!==missing)!.Id;
 const capture=async()=>{const [r]=await sql`select md5(coalesce(jsonb_agg(r order by r.id)::text,'')) as value from reading_history r where user_id=${admin.id}`;return r.value;};
 const history=await capture();
 const [job]=await sql`select id,attempts from outbox_actions where user_id=${admin.id} and connection_id=${link.id} and kind='jellyfin.sync' order by created_at limit 1`;assert(job,'Actual admin sync job absent');
 await assert.rejects(()=>original.syncJellyfinChanges(admin.id,link.id,'user',{video:[],music:[],reading:[missing!,available]},context), (cause:any)=>[404,410].includes(cause.status));
 report.cases.push({name:'Original method aborts on actual missing hinted file before the accessible sibling',status:'reproduced'});
 const changed=await syncJellyfinChanges(admin.id,link.id,'user',{video:[],music:[],reading:[missing,available]},context);
 assert.equal(changed.deferred,1);assert.equal(changed.checked,2);
 const [admitted]=await sql`select count(*)::int as count from availability a join provider_items p on p.id=a.provider_item_id where a.user_id=${admin.id} and a.connection_id=${link.id} and a.state='available' and replace(lower(p.external_id),'-','')=${available}`;assert(admitted.count>0);
 report.cases.push({name:'Candidate records actual missing file and admits accessible sibling',status:'passed',checked:changed.checked,deferred:changed.deferred});console.log('Actual missing-file/sibling comparison passed.');
 // Both methods receive the genuine adapter. Only the unrelated first screen
 // page is held by a sentinel; no upstream response or media is fabricated.
 const blocked={...context,adapter:new Proxy(context.adapter,{get(target,key){if(key==='library')return async()=>{throw new Error('actual-screen-gate');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})};
 const reset=async()=>{
  await sql`update availability set state='unknown' where user_id=${admin.id} and connection_id=${link.id} and media_id in(select id from reading_works)`;
  await sql`delete from sync_checkpoints where connection_id=${link.id} and kind='jellyfin-user'`;
  await sql`update provider_connections set settings=settings-'userSync' where id=${link.id}`;
 };
 const count=async()=>Number((await sql`select count(distinct a.media_id)::int as count from availability a join reading_works r on r.id=a.media_id where a.user_id=${admin.id} and a.connection_id=${link.id} and a.state='available'`)[0].count);
 await reset();await sql`update outbox_actions set state='running',attempts=attempts+1,locked_at=now(),payload='{}'::jsonb where id=${job.id}`;
 const execute=async(work:()=>Promise<unknown>)=>{const [current]=await sql`select attempts,payload from outbox_actions where id=${job.id}`;return jobExecution.run({id:job.id,userId:admin.id,kind:'jellyfin.sync',payload:current.payload,attempts:current.attempts,purpose:'scheduled',started:performance.now(),checkpoints:0},work);};
 await assert.rejects(()=>execute(()=>original.syncJellyfinUser(admin.id,link.id,undefined,blocked)),/actual-screen-gate/);assert.equal(await count(),0);
 report.cases.push({name:'Original held screen traversal admits zero reading works',status:'reproduced'});
 await reset();await sql`update outbox_actions set payload='{}'::jsonb where id=${job.id}`;
 await assert.rejects(()=>execute(()=>syncJellyfinUser(admin.id,link.id,undefined,blocked)),cause=>cause instanceof JobYield);
 const positives=await count();assert(positives>0);
 const [checkpoint]=await sql`select payload->'_checkpoint' as point from outbox_actions where id=${job.id}`;assert.equal(checkpoint.point.task,'jellyfin-reading-access');assert(checkpoint.point.offset>0);assert.equal(checkpoint.point.done,false);
 assert.equal(await capture(),history);
 report.cases.push({name:'Candidate admits actual reading works before held screen traversal without reading-history effects',status:'passed',positiveWorks:positives});
 report.status='passed';
}catch(cause){report.status='failed';report.failure=String(cause);throw cause;}
finally{await frozen.cleanup();await closeDb();await Bun.write('/private/tmp/coast-task-native-reading-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
