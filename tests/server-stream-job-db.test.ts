import {test,expect,beforeAll,afterAll,mock} from 'bun:test';
import {getSql,closeDb} from '../src/lib/server/db';
import * as connection from '../src/lib/providers/jellyfin/connection.server';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {registerProviderActions} from '../src/lib/providers/actions.server';
import {enqueueAction,runQueueOnce} from '../src/lib/server/queue';
import {activeStreams,streamCount} from '../src/lib/application/streams.server';
import {updateConfig} from '../src/lib/application/configuration.server';
import {diagnosticStore} from '../src/lib/server/diagnostics';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const user=crypto.randomUUID(),instance=crypto.randomUUID(),source=crypto.randomUUID(),generation=crypto.randomUUID();
const actor={id:user,username:'stream-fixture',role:'admin' as const,email:null,settings:{}};
let failing=false,administrator=true,calls:string[]=[];
const adapter=new JellyfinAdapter(async path=>{
 calls.push(path);
 if(path.startsWith('/Users/'))return {Id:'fixture',Name:'Fixture',Policy:{IsAdministrator:administrator}};
 if(failing)throw new Error('Synthetic session read failure');
 return [{Id:'stream',UserName:'Fixture',NowPlayingItem:{Id:'title',Name:'Fixture movie',Type:'Movie'},PlayState:{IsPaused:false}}];
},user);
if(enabled)mock.module('../src/lib/providers/jellyfin/connection.server',()=>({...connection,getJellyfin:async()=>({connection:{externalUserId:'fixture'},adapter})}));
beforeAll(async()=>{
 if(!enabled)return;
 const sql=getSql();
 await sql`insert into users(id,username,role) values(${user},${actor.username},'admin')`;
 await sql`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Stream fixture','https://fixture.invalid')`;
 await sql`insert into provider_connections(id,user_id,instance_id,status,account_generation,credentials) values(${source},${user},${instance},'connected',${generation},'fixture')`;
 await updateConfig(actor,{developerMode:true});registerProviderActions({maintenance:false});
});
afterAll(async()=>{if(enabled){await closeDb();mock.restore();}});
const enqueue=()=>enqueueAction({userId:user,connectionId:source,kind:'jellyfin.streams',payload:{},purpose:'manual'});
run('registered scan job verifies permissions, records streams under its lease and publishes the cached count',async()=>{
 const id=await enqueue();expect(await runQueueOnce()).toBe(true);
 const [job]=await getSql()`select state,last_error,payload from outbox_actions where id=${id}`;
 expect(job.last_error).toBeNull();expect(job.state).toBe('succeeded');expect(job.payload._jobOutcome.checked).toBe(1);
 expect(calls).toEqual(['/Users/fixture','/Sessions?ActiveWithinSeconds=120']);
 expect((await streamCount(actor)).active).toBe(1);expect((await activeStreams(actor)).streams[0].title).toBe('Fixture movie');
});
run('failed session reads retain observations and identify the failing execution stage',async()=>{
 failing=true;const id=await enqueue();expect(await runQueueOnce()).toBe(true);
 expect((await getSql()`select state from outbox_actions where id=${id}`)[0].state).toBe('failed');
 expect((await streamCount(actor)).active).toBeNull();expect((await activeStreams(actor)).streams).toHaveLength(1);
 const diagnostics=await diagnosticStore.recent();
 expect(diagnostics.some(row=>row.detail.actionId===id&&row.detail.stage==='streams-sessions')).toBe(true);
});
run('non-administrator Jellyfin accounts are rejected before reading sessions',async()=>{
 await getSql()`delete from outbox_actions where user_id=${user}`;
 calls=[];failing=false;administrator=false;const id=await enqueue();expect(await runQueueOnce()).toBe(true);
 expect((await getSql()`select state from outbox_actions where id=${id}`)[0].state).toBe('failed');
 expect(calls).toEqual(['/Users/fixture']);expect((await activeStreams(actor)).issues[0].message).toContain('Jellyfin administrator');
});
