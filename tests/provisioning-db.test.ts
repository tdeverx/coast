import {test,beforeAll,afterAll,expect,mock} from 'bun:test';
import {getSql,closeDb} from '../src/lib/server/db';
import * as connection from '../src/lib/providers/jellyfin/connection.server';
import {provisionOnboarding} from '../src/lib/providers/jellyfin/provisioning.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const admin=crypto.randomUUID(),instance=crypto.randomUUID(),source=crypto.randomUUID(),generation=crypto.randomUUID(),folder='a'.repeat(32);
let mode='ok',creates=0,policies:Record<string,unknown>[]=[],remoteName='';
if(process.env.COAST_DB_TEST==='1')mock.module('../src/lib/providers/jellyfin/connection.server',()=>({...connection,getJellyfin:async()=>({connection:{externalUserId:admin,accountGeneration:mode==='replacement'?crypto.randomUUID():generation},instance:{id:instance,serverIdentity:'pinned'},adapter:{identity:async(id:string)=>{expect(id).toBe('pinned');},userPolicy:async()=>({administrator:mode!=='not-admin',disabled:false}),virtualFolders:async()=>[{ItemId:folder}],createUser:async(name:string,password:string)=>{creates++;remoteName=name;expect(password).not.toBe('Provision-fixture-pass!');if(mode==='lost')throw new Error('Lost response');return {Id:'b'.repeat(32)};},userForProvisioning:async()=>({Name:remoteName,Policy:{EnableAllFolders:true,IsAdministrator:false}}),setProvisionPolicy:async(_:string,policy:Record<string,unknown>)=>{policies.push(policy);if(mode==='configure-failure')throw new Error('Policy unavailable');},setProvisionPassword:async()=>{}}}),connectJellyfin:async(userId:string)=>{const [row]=await getSql()`insert into provider_connections(user_id,instance_id,status,account_generation) values(${userId},${instance},'connected',${crypto.randomUUID()}) returning id`;return row;}}));
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await getSql()`insert into users(id,username,role) values(${admin},'provision-admin','admin')`;await getSql()`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Fixture','https://fixture.invalid')`;await getSql()`insert into provider_connections(id,user_id,instance_id,status,account_generation) values(${source},${admin},${instance},'connected',${generation})`;});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1'){await closeDb();mock.restore();}});
async function invited(){const id=crypto.randomUUID();await getSql()`insert into users(id,username,role) values(${id},${'provision-'+id.slice(0,8)},'user')`;await getSql()`insert into user_onboarding(user_id,required_provider) values(${id},'jellyfin')`;await getSql()`insert into onboarding_provisioning(user_id,connection_id,account_generation,folders) values(${id},${source},${generation},${JSON.stringify([folder])}::text::jsonb)`;return id;}
const input={password:'Provision-fixture-pass!',passwordConfirmation:'Provision-fixture-pass!'};
run('successful provisioning restricts libraries and binds the selected user connection',async()=>{
 mode='ok';const id=await invited();await provisionOnboarding(id,input);const [row]=await getSql()`select p.state,o.connection_id,o.account_generation from onboarding_provisioning p join user_onboarding o on o.user_id=p.user_id where p.user_id=${id}`;expect(row.state).toBe('complete');expect(row.connection_id).toBeTruthy();expect(row.account_generation).toBeTruthy();expect(policies.at(-1)?.EnabledFolders).toEqual([folder]);expect(policies.at(-1)?.EnableAllFolders).toBe(false);
});
run('lost creation responses require review and never create a duplicate',async()=>{
 mode='lost';const id=await invited(),before=creates;await expect(provisionOnboarding(id,input)).rejects.toThrow('uncertain');expect(creates).toBe(before+1);mode='ok';await expect(provisionOnboarding(id,input)).rejects.toThrow('review');expect(creates).toBe(before+1);
});
run('known creations retry configuration without creating another account',async()=>{
 mode='configure-failure';const id=await invited(),before=creates;await expect(provisionOnboarding(id,input)).rejects.toThrow('incomplete');expect(creates).toBe(before+1);mode='ok';await provisionOnboarding(id,input);expect(creates).toBe(before+1);
});
run('replacement and loss of administrator rights reject creation before remote writes',async()=>{
 for(const failure of ['replacement','not-admin']){mode=failure;const id=await invited(),before=creates;await expect(provisionOnboarding(id,input)).rejects.toThrow();expect(creates).toBe(before);}mode='ok';
});
