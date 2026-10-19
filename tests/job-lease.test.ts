import {expect,test} from 'bun:test';
import {assertJobLease,jobExecution,JobYield} from '../src/lib/server/queue/execution';

const execution={id:'10000000-0000-4000-8000-000000000001',attempts:3,purpose:'scheduled' as const,started:0,checkpoints:0};
function raw(lease=true,allowed=true){
 const queries:{text:string;values:unknown[]}[]=[];
 const store={unsafe:async(text:string,values:unknown[])=>{queries.push({text,values});return text.includes('coast_job_allowed')?[{allowed}]:lease?[{id:execution.id}]:[];}};
 return {store:store as unknown as Parameters<typeof assertJobLease>[0],queries};
}

test('direct cleanup has no job lease or policy query',async()=>{
 const current=raw();await assertJobLease(current.store,true);expect(current.queries).toEqual([]);
});

test('raw transaction lease binds exact identity/attempt and locks only when requested',async()=>{
 for(const lock of [false,true]){
  const current=raw();await jobExecution.run(execution,()=>assertJobLease(current.store,lock));
  expect(current.queries).toHaveLength(1);expect(current.queries[0].values).toEqual([execution.id,3]);
  expect(current.queries[0].text.endsWith(' for update')).toBe(lock);
 }
});

test('raw policy check retains exact job payload and denied work never takes its lease lock',async()=>{
 const context={...execution,userId:'20000000-0000-4000-8000-000000000002',kind:'feature.reconcile',payload:{cutoff:'2026-10-18T00:00:00Z',choices:{reader:false}}};
 const allowed=raw();await jobExecution.run(context,()=>assertJobLease(allowed.store,true));
 expect(allowed.queries).toHaveLength(2);expect(allowed.queries[0].values).toEqual([context.userId,context.kind,JSON.stringify(context.payload)]);
 const denied=raw(true,false);await expect(jobExecution.run(context,()=>assertJobLease(denied.store,true))).rejects.toBeInstanceOf(JobYield);expect(denied.queries).toHaveLength(1);
});

test('missing or stale raw lease yields instead of allowing the mutation continuation',async()=>{
 const current=raw(false);let mutated=false;
 await expect(jobExecution.run(execution,async()=>{await assertJobLease(current.store,true);mutated=true;})).rejects.toBeInstanceOf(JobYield);
 expect(mutated).toBe(false);
});

const featureSource=await Bun.file(new URL('../src/lib/application/feature-transition.server.ts',import.meta.url)).text();
const featureBody=new Bun.Transpiler({loader:'ts'}).transformSync(featureSource.slice(featureSource.indexOf('export async function reconcileFeatures(')).replace('export ',''));
function featureChunks(loseAt=Number.POSITIVE_INFINITY){
 const events:string[]=[];let chunk=0,reads=0;
 const transaction=Object.assign(async(strings:TemplateStringsArray)=>{
  if(strings[0].includes('pg_advisory_xact_lock')){events.push(`account:${chunk}`);return [];}
  events.push(`mutation:${chunk}`);
  return strings[0].includes('update synced_rooms')&&chunk===1?Array.from({length:100},()=>({id:'owned-room'})):[];
 },{unsafe:async(text:string)=>{events.push(`${text.includes('coast_job_allowed')?'policy':'lease'}:${chunk}`);return text.includes('coast_job_allowed')?[{allowed:true}]:chunk<loseAt?[{id:execution.id}]:[];}});
 const database=Object.assign(async()=>++reads===1?[{id:'owner',settings:{}}]:[],{begin:async(callback:(tx:typeof transaction)=>unknown)=>{chunk++;return callback(transaction);}});
 const run=new Function('getSql','featureValues','assertJobLease','readJobCheckpoint','saveJobCheckpoint','jobCheckpoint',featureBody+';return reconcileFeatures;')(
  ()=>database,()=>Object.fromEntries(['presence','parties','reader','book','comic','playback','music','screen','sharing','api','planning','game','personalisation','requests'].map(key=>[key,true])),assertJobLease,async()=>null,async()=>{},async()=>{});
 return {run,events};
}

test('feature withdrawal fences every bounded chunk after its account lock and before mutations',async()=>{
 const current=featureChunks();
 await jobExecution.run({...execution,userId:execution.id,kind:'feature.reconcile'},()=>current.run({payload:{config:{},cutoff:'2026-10-18T00:00:00Z'}}));
 for(const chunk of [1,2]){
  const events=current.events.filter(event=>event.endsWith(':'+chunk));
  expect(events.slice(0,3)).toEqual([`account:${chunk}`,`policy:${chunk}`,`lease:${chunk}`]);
  expect(events.slice(3).every(event=>event===`mutation:${chunk}`)).toBe(true);
 }
});

test('a replaced feature lease cannot reach the following chunk mutations',async()=>{
 const current=featureChunks(2);
 await expect(jobExecution.run({...execution,userId:execution.id,kind:'feature.reconcile'},()=>current.run({payload:{config:{},cutoff:'2026-10-18T00:00:00Z'}}))).rejects.toBeInstanceOf(JobYield);
 expect(current.events.filter(event=>event.endsWith(':2'))).toEqual(['account:2','policy:2','lease:2']);
 expect(current.events).toContain('mutation:1');
});
