import {afterAll,expect,test} from 'bun:test';
import {compileRunes,moduleUrl} from './fixtures/ui-script';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
const source=await Bun.file('src/lib/ui/task-control.svelte.ts').text();
const client=await import(moduleUrl(compileRunes(source)));
const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
afterAll(()=>{if(storageDescriptor)Object.defineProperty(globalThis,'sessionStorage',storageDescriptor);else Reflect.deleteProperty(globalThis,'sessionStorage');});
const spec={kind:'jellyfin.live',instanceId:null,action:'cancel' as const};
const result=(id:string,status='incomplete')=>({...spec,id,status,revision:0,updated:0,skipped:0,total:2,remaining:2,hasMore:false,blocked:false,error:null,compacted:false});
test('lost admission reuses the same identity; completion alone clears browser recovery',async()=>{
 const storage=new Map();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,writable:true,value:{setItem:(k:string,v:string)=>storage.set(k,v),getItem:(k:string)=>storage.get(k),removeItem:(k:string)=>storage.delete(k)}});
 client.pendingTaskControl.value=null;let id='';
 await expect(client.runTaskControl('one',spec,async(_path:string,body:any)=>{id=body.commandId;throw Error('response lost');},()=>true)).rejects.toThrow('response lost');
 expect(client.pendingTaskControl.value.id).toBe(id);
 const calls:string[]=[];const done=await client.runTaskControl('one',spec,async(path:string,body:any)=>{calls.push(path);if(path.includes('/tasks/')){expect(body.commandId).toBe(id);return result(id);}return {...result(id,'complete'),updated:2,remaining:0,revision:2};},()=>true);
 expect(done.status).toBe('complete');expect(calls).toEqual(['queue/tasks/cancel',`queue/task-commands/${id}/resume`]);expect(client.pendingTaskControl.value).toBeNull();expect(storage.size).toBe(0);
});
test('account withdrawal during admission cannot start the old actor continuation',async()=>{
 client.pendingTaskControl.value=null;let current=true;const calls:string[]=[];
 await client.runTaskControl('two',spec,async(path:string,body:any)=>{calls.push(path);current=false;return result(body.commandId);},()=>current);
 expect(calls).toEqual(['queue/tasks/cancel']);expect(client.pendingTaskControl.value.actorId).toBe('two');
 client.restoreTaskControl('different');expect(client.pendingTaskControl.value).toBeNull();
});
test('interrupted receipts remain resumable and complete-only messages distinguish remaining work',async()=>{
 client.pendingTaskControl.value=null;
 const interrupted=await client.runTaskControl('three',spec,async(path:string,body:any)=>path.includes('/tasks/')?result(body.commandId):{...result(client.pendingTaskControl.value.id),updated:1,remaining:1,error:'Interrupted'},()=>true);
 expect(interrupted.error).toBe('Interrupted');expect(client.pendingTaskControl.value).not.toBeNull();expect(client.taskControlMessage(interrupted)).toBe('Interrupted');
 expect(client.taskControlMessage({...interrupted,error:null})).toContain('Resume');
});
test('the production task request owner survives same-account refresh and aborts on account withdrawal',async()=>{
 const component=await Bun.file('src/lib/ui/components/JobSchedule.svelte').text();
 const owner=component.match(/const taskActor=\$derived\(page\.data\.user\?\.id\);\s*\$effect\(\(\)=>\{taskActor;return \(\)=>taskRequest\?\.abort\(\);\}\);/);
 expect(owner).not.toBeNull();
 const {fixture}=await import(moduleUrl(compileRunes(`export function fixture(){const page=$state({data:{user:{id:'one'}}});let taskRequest;${owner![0]}return {start(){taskRequest=new AbortController();return taskRequest.signal;},refresh(id){page.data={user:{id}};}};}`)));
 let instance:any;const dispose=runtime.effect_root(()=>instance=fixture());runtime.flush();
 try{const signal=instance.start();instance.refresh('one');runtime.flush();expect(signal.aborted).toBe(false);instance.refresh('two');runtime.flush();expect(signal.aborted).toBe(true);}finally{dispose();}
});
