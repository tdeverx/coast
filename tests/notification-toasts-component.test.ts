import {expect,test} from 'bun:test';
// @ts-expect-error The internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';
let script=await componentScript('src/lib/ui/components/NotificationToasts.svelte');
const start=script.indexOf('let { notifications'),end=script.indexOf('= $props();',start)+'= $props();'.length;
script=script.slice(0,start)+'let notifications=$state.raw(initial),initialFailure;'+script.slice(end);
const source=`import {createNotificationToasts} from ${JSON.stringify(import.meta.resolve('../src/lib/ui/controls/notification-toasts'))};export function create(initial,client,ApiError){const mounts=[];const onMount=run=>mounts.push(run),useClient=()=>client,refreshAfterChange=async()=>{};${script}
 return {mount(){return mounts[0]();},replace(next){notifications=next;},dismiss(id){toasts.dismiss(notifications.find(n=>n.id===id));},retry(){return toasts.retry();},get visible(){return visible;}};}`;
const {create}=await import(moduleUrl(compileRunes(source)));
const settle=async()=>{for(let i=0;i<5;i++){runtime.flush();await Promise.resolve();}};
test('compiled notification host updates are finite, preserve initial hiding and fence unmounted writes',async()=>{
 const calls:{path:string;body:any;reject:()=>void}[]=[];const failures:string[]=[];let owner:any,cleanup:()=>void;
 const client={preview:false,api:(path:string,body:any)=>new Promise((_yes,reject)=>calls.push({path,body,reject:()=>reject(Error('Late failure'))})),feedback:{activeHost:null,current:null,failure:(text:string)=>failures.push(text),clear:()=>{}}};
 const old={id:'old',title:'Notice',body:null,level:'normal',readAt:null,toastHiddenAt:null,createdAt:new Date(0)};
 const dispose=runtime.effect_root(()=>{owner=create([old],client);});runtime.flush();cleanup=owner.mount();await settle();
 expect(owner.visible).toEqual([]);expect(calls.map(c=>c.path)).toEqual(['notifications/toast-hidden']);expect(calls[0].body).toEqual({ids:['old']});
 owner.replace([{...old,id:'arrival',createdAt:new Date()}]);await settle();expect(owner.visible.map((n:any)=>n.id)).toEqual(['arrival']);
 cleanup();dispose();calls[0].reject();await settle();expect(failures).toEqual([]);expect(calls).toHaveLength(1);
});

const clientSource=await Bun.file(new URL('../src/lib/ui/client.ts',import.meta.url)).text();
const classStart=clientSource.indexOf('export class ApiError'),classEnd=clientSource.indexOf('/**',classStart);
const {ApiError}=await import(moduleUrl(new Bun.Transpiler({loader:'ts'}).transformSync(clientSource.slice(classStart,classEnd))));
function persistentFixture(){
 const calls:{path:string;resolve:()=>void;reject:(cause:unknown)=>void}[]=[],failures:string[]=[];let owner:any;
 const persistent={id:'persistent',title:'Notice',body:null,level:'persistent',readAt:null,toastHiddenAt:null,createdAt:new Date()};
 const normal={...persistent,id:'normal',level:'normal'};
 const client={preview:false,api:(path:string)=>new Promise<void>((resolve,reject)=>calls.push({path,resolve,reject})),feedback:{activeHost:null,current:null,failure:(text:string)=>failures.push(text),clear:()=>{},notify:()=>{}}};
 const dispose=runtime.effect_root(()=>{owner=create([persistent],client,ApiError);});runtime.flush();const cleanup=owner.mount();runtime.flush();
 return {owner,calls,failures,persistent,normal,dispose(){cleanup();dispose();}};
}
test('persistent lost acknowledgement then genuine404 is terminal and drains a later normal hide',async()=>{
 const f=persistentFixture();try{
  f.owner.dismiss('persistent');f.calls[0].reject(Error('Response lost after commit'));await settle();expect(f.failures).toHaveLength(1);expect(f.owner.visible.map((n:any)=>n.id)).toEqual(['persistent']);
  f.owner.replace([f.persistent,f.normal]);await settle();f.owner.dismiss('normal');expect(f.calls).toHaveLength(1);
  const retry=f.owner.retry();expect(f.calls[1].path).toBe('notifications/persistent');f.calls[1].reject(new ApiError('Notification not found.',404));await retry;await settle();
  expect(f.calls[2].path).toBe('notifications/toast-hidden');expect(f.owner.visible).toEqual([]);f.calls[2].resolve();await settle();expect(f.failures).toHaveLength(1);
 }finally{f.dispose();}
});
test('deleted or no-longer-visible404 dismissals are terminal, while genuine401/403/5xx and non-ApiError404 retain retry',async()=>{
 for(const reason of ['deleted','no-longer-visible']){
  const f=persistentFixture();try{f.owner.dismiss('persistent');f.calls[0].reject(new ApiError(reason,404));await settle();expect(f.failures).toEqual([]);expect(f.owner.visible).toEqual([]);expect(await f.owner.retry()).toBe(false);}finally{f.dispose();}
 }
 for(const cause of [new ApiError('Session expired',401),new ApiError('Forbidden',403),new ApiError('Server failure',500),{status:404}]){
  const f=persistentFixture();try{f.owner.dismiss('persistent');f.calls[0].reject(cause);await settle();expect(f.failures).toHaveLength(1);expect(f.owner.visible.map((n:any)=>n.id)).toEqual(['persistent']);const retry=f.owner.retry();expect(f.calls).toHaveLength(2);f.calls[1].resolve();expect(await retry).toBe(true);}finally{f.dispose();}
 }
});
