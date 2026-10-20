/** Read-only offline replay of narrowly exported REAL task metadata.
 * Never connects to a database, dispatches a handler or manufactures task rows.
 * Input: private readonly-task-evidence.private.json from this audit's collector.
 * The optional third argument supports the separately captured original account context.
 */
import assert from 'node:assert/strict';
import {jobTaskSections,taskJobCount,type QueueAction} from '../../../src/lib/ui/queue';
import {serviceTasks} from '../../../src/lib/providers/tasks';
import {providerSchedule} from '../../../src/lib/providers/schedule';
import {taskDue} from '../../../src/lib/providers/task-timing';
const path=process.argv[2],accountPath=process.argv[3];
assert(path,'Pass the private actual-task metadata export.');
const evidence=await Bun.file(path).json();
assert(Array.isArray(evidence.counts)&&evidence.counts.length>0,'No actual task census.');
assert(Array.isArray(evidence.representatives)&&evidence.representatives.length>0,'No actual active task representatives.');
const checks:{name:string;result:unknown}[]=[];
function record(name:string,result:unknown){checks.push({name,result});}
const jobs:QueueAction[]=evidence.representatives;
const entries=[...new Set(jobs.map(job=>`${job.instanceId}:${job.kind}`))].map(key=>({key,jobs:jobs.filter(job=>`${job.instanceId}:${job.kind}`===key)}));
const sections=jobTaskSections(entries);
const hidden=sections.waiting.filter(entry=>taskJobCount(entry.jobs,'failed')>0).map(entry=>({kind:entry.jobs[0].kind,failed:taskJobCount(entry.jobs,'failed'),waiting:taskJobCount(entry.jobs,'pending')}));
assert(hidden.length>0,'The observed mixed failure/waiting cohort is absent; recapture rather than inventing it.');
assert(hidden.every(entry=>!sections.attention.some(other=>other.jobs[0].kind===entry.kind)));
record('Actual mixed-state tasks reproduce failure exclusion from Needs attention',hidden);
const providers=[...new Set(evidence.schedules.map((row:any)=>row.provider))].filter((provider:any)=>['jellyfin','trakt','steam','seerr','tmdb','igdb'].includes(provider));
let taskCards=0;
for(const provider of providers){for(const task of serviceTasks(String(provider))){assert.equal(task.kinds.length,1);taskCards++;}}
record('Discarded bulk-control concern: production service normalization produces one kind per task card',{providers:providers.length,taskCards});
const failed=jobs.find(job=>job.state==='failed'&&job.kind==='steam.achievements');
assert(failed,'Actual failed recurring Steam task absent; no synthetic substitute.');
const integration=evidence.schedules.find((row:any)=>row.id===failed.instanceId);
assert(integration);
assert(evidence.accounts||accountPath,'Pass actual connected-account task context.');
const accounts=evidence.accounts??await Bun.file(accountPath!).json();
const account=accounts.find((row:any)=>row.instanceId===integration.id);assert(account);
const task=serviceTasks('steam').find(task=>task.kinds[0]===failed.kind)!;
const forced=taskDue(task,providerSchedule('steam',integration.schedule),{}, account,{blocked:true},Date.now(),true);
assert.equal(forced.at,null);
record('Shared due owner refuses an explicitly forced run while the actual failed task counts as active',{kind:failed.kind,forcedAt:forced.at,boundary:'Pure branch replay with actual task schedule/account; maintenance SQL separately confirms failed is active. No handler is dispatched.'});
const notifications=evidence.notification_counts;
assert(Array.isArray(notifications)&&notifications.length>0);
assert.equal(notifications[0].tasks,notifications[0].notification_rows);
record('Failure notifications exist for every observed failed task',notifications[0]);
assert.equal(evidence.generations.length,0);
record('No active stale-account-generation cohort observed',0);
assert(evidence.payload_sizes.every((row:any)=>row.over_256k===0));
record('No actual active action payload exceeds the 256KiB admission bound',{kinds:evidence.payload_sizes.length,maxBytes:Math.max(...evidence.payload_sizes.map((row:any)=>row.max_bytes))});
const source=await Bun.file(new URL('../../../src/lib/providers/actions.server.ts',import.meta.url)).text();
const body=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(source.indexOf('export function registerProviderActions(')).replace('export ',''));
const registered:string[]=[];
const enumerate=new Function('registerActionHandler','executeSeerrManagement','executeSeerrRequest','startProviderMaintenance',body+';return registerProviderActions;')((kind:string)=>registered.push(kind),()=>{},()=>{},()=>{});
enumerate({maintenance:false});
assert.equal(new Set(registered).size,registered.length);
const unknown=jobs.filter(job=>!registered.includes(job.kind));assert.equal(unknown.length,0);
record('Every observed active kind has exactly one registered handler',{registered:registered.length,observedActive:new Set(jobs.map(job=>job.kind)).size});
const seen=new Set(evidence.counts.map((row:any)=>row.kind));
record('Real task coverage, without interpreting absent providers as passing',{observedRegistered:registered.filter(kind=>seen.has(kind)),unobservedRegistered:registered.filter(kind=>!seen.has(kind)),legacyObserved:[...seen].filter(kind=>!registered.includes(kind as string))});
console.log(JSON.stringify({status:'passed',meaning:'These checks confirm current behavior and audit findings; they are not acceptance tests for fixes.',checks},null,2));
