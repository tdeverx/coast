import type { TaskControlCommand, TaskControlSpec } from '#lib/providers/task-control.js';
type Pending = TaskControlSpec & {id:string;actorId:string};
export const pendingTaskControl=$state<{value:Pending|null;pause:{token:symbol;stop:()=>void}|null}>({value:null,pause:null});
const key=(actor:string)=>`coast:task-control:${actor}`;
function save(value:Pending) {
  pendingTaskControl.value=value;
  try{sessionStorage.setItem(key(value.actorId),JSON.stringify(value));}catch{/* Server admission remains durable when browser storage is unavailable. */}
}
export function restoreTaskControl(actor:string) {
  if(pendingTaskControl.value?.actorId===actor)return;
  pendingTaskControl.value=null;
  try{
    const raw=sessionStorage.getItem(key(actor));if(!raw||raw.length>1024)return;
    const data=JSON.parse(raw);
    if(data.actorId===actor&&typeof data.id==='string'&&/^[a-f0-9-]{36}$/i.test(data.id)&&typeof data.kind==='string'&&['cancel','retry','promote'].includes(data.action)&&(data.instanceId===null||typeof data.instanceId==='string'))pendingTaskControl.value=data;
  }catch{/* Invalid scratch descriptors never become server authority. */}
}
function clear(actor:string,id:string) {
  if(pendingTaskControl.value?.actorId===actor&&pendingTaskControl.value.id===id)pendingTaskControl.value=null;
  try{const raw=sessionStorage.getItem(key(actor));if(raw&&raw.length<=1024&&JSON.parse(raw).id===id)sessionStorage.removeItem(key(actor));}catch{}
}
type Send = (path:string,body:object)=>Promise<TaskControlCommand>;
export async function runTaskControl(actor:string,spec:TaskControlSpec,send:Send,current:()=>boolean,id?:string,pause?:()=>void) {
  const pending=pendingTaskControl.value;
  const reuse=pending?.actorId===actor&&pending.kind===spec.kind&&pending.instanceId===spec.instanceId&&pending.action===spec.action?pending.id:undefined;
  const commandId=id??reuse??crypto.randomUUID();save({...spec,id:commandId,actorId:actor});
  const token=Symbol();if(pause)pendingTaskControl.pause={token,stop:pause};
  try{
  const admitted=await send(`queue/tasks/${spec.action}`,{kind:spec.kind,instanceId:spec.instanceId,commandId});
  if(!current())return;
  const result=admitted.status==='incomplete'?await send(`queue/task-commands/${admitted.id}/resume`,{revision:admitted.revision}):admitted;
  if(!current())return;
  if(result.status!=='incomplete')clear(actor,commandId);
  return result;
  }finally{if(pendingTaskControl.pause?.token===token)pendingTaskControl.pause=null;}
}
export async function abandonTaskControl(actor:string,id:string,spec:TaskControlSpec,send:Send,current:()=>boolean) {
  const result=await send(`queue/task-commands/${id}/abandon`,spec);
  if(!current())return;
  clear(actor,id);return result;
}
export function taskControlMessage(result:TaskControlCommand) {
  if(result.status==='abandoned')return `Task action abandoned · ${result.updated} updated · ${result.skipped} skipped.`;
  if(result.status!=='complete')return result.error??`Task action paused · ${result.updated} updated · ${result.skipped} skipped · ${result.remaining} remaining. Resume to continue.`;
  return `${result.updated} jobs ${result.action==='retry'?'queued for retry':result.action==='cancel'?'cancelled':'prioritized'}${result.skipped?` · ${result.skipped} unchanged because the job changed or already has active work`:''}${result.hasMore?' · More eligible jobs remain; use the action again for the next batch':''}${result.blocked?' · Some failures must wait for queued or running work for the same task':''}.`;
}
