import {expect,test} from 'bun:test';
import {createNotificationToasts,type ToastNotification} from '../src/lib/ui/controls/notification-toasts';
const now=1_000_000;
function notice(id:string,overrides:Partial<ToastNotification>={}):ToastNotification{return {id,title:'Notice',body:null,level:'normal',readAt:null,toastHiddenAt:null,createdAt:new Date(now),...overrides};}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture(preview=false,refresh:()=>Promise<void>=async()=>{}){
 const timers=new Map<number,{run:()=>void;ms:number}>();let next=0;
 const calls:{kind:string;ids:string[];signal:AbortSignal;resolve:()=>void;reject:()=>void}[]=[],failures:string[]=[];let recovered=0;
 const invoke=(kind:string,ids:string[],signal:AbortSignal)=>new Promise<void>((yes,no)=>{
  const resolve=()=>{signal.removeEventListener('abort',reject);yes();},reject=()=>{signal.removeEventListener('abort',reject);no(Error('Offline'));};
  calls.push({kind,ids,signal,resolve,reject});signal.addEventListener('abort',reject,{once:true});
 });
 const owner=createNotificationToasts({preview,hide:(ids,signal)=>invoke('hide',ids,signal),dismiss:(id,signal)=>invoke('dismiss',[id],signal),changed:()=>{},failure:text=>failures.push(text),recovered:()=>{recovered++;},refresh,refreshFailure:()=>failures.push('saved-refresh-failed'),now:()=>now,delay:(run,ms)=>{const id=++next;timers.set(id,{run,ms});return id as unknown as ReturnType<typeof setTimeout>;},cancel:timer=>{timers.delete(timer as unknown as number);}});
 return {owner,calls,timers,failures,get recovered(){return recovered;},expire(ms=7000){const [id,timer]=[...timers].find(([,timer])=>timer.ms===ms)!;timers.delete(id);timer.run();}};
}
test('normal auto and manual hiding share durable writes while persistent dismissal keeps its own command',async()=>{
 const f=fixture();f.owner.mount([notice('auto'),notice('manual'),notice('persistent',{level:'persistent'})]);
 expect(f.owner.visible.map(n=>n.id)).toEqual(['auto','manual','persistent']);expect(f.timers.size).toBe(2);
 f.expire();expect(f.calls.map(c=>[c.kind,c.ids])).toEqual([['hide',['auto']]]);
 f.owner.dismiss(notice('manual'));f.owner.dismiss(notice('persistent',{level:'persistent'}));expect(f.calls).toHaveLength(1);
 f.calls[0].resolve();await settle();expect(f.calls[1].kind).toBe('hide');expect(f.calls[1].ids).toEqual(['manual']);
 f.calls[1].resolve();await settle();expect(f.calls[2].kind).toBe('dismiss');expect(f.calls[2].ids).toEqual(['persistent']);
 f.calls[2].resolve();await settle();expect(f.owner.visible).toEqual([]);f.owner.dispose();expect(f.timers.size).toBe(0);
});
test('initial-only age suppression, durable reload suppression and window pruning preserve arrival policy',async()=>{
 const f=fixture();f.owner.mount([notice('old',{createdAt:new Date(now-30_001)}),notice('saved',{toastHiddenAt:new Date(now)}),notice('silent',{level:'silent'})]);
 expect(f.owner.visible).toEqual([]);expect(f.calls[0].ids).toEqual(['old']);f.calls[0].resolve();await settle();
 f.owner.update([notice('late-old',{createdAt:new Date(now-60_000)})]);expect(f.owner.visible.map(n=>n.id)).toEqual(['late-old']);expect(f.timers.size).toBe(1);
 f.owner.update([]);expect(f.timers.size).toBe(0);
 f.owner.update([notice('late-old')]);expect(f.timers.size).toBe(1);f.expire();expect(f.calls[1].ids).toEqual(['late-old']);
 f.owner.dispose();f.calls[1].resolve();await settle();
 const reload=fixture();reload.owner.mount([notice('late-old',{toastHiddenAt:new Date(now)})]);expect(reload.owner.visible).toEqual([]);expect(reload.calls).toHaveLength(0);reload.owner.dispose();
});
test('failed writes retain bounded intent across windows, retry once, and never change persistent failure rollback',async()=>{
 const f=fixture();f.owner.mount([notice('one')]);f.owner.dismiss(notice('one'));f.owner.update([]);f.calls[0].reject();await settle();expect(f.failures).toHaveLength(1);
 f.owner.update([notice('one'),notice('two',{level:'persistent'})]);expect(f.owner.visible.map(n=>n.id)).toEqual(['two']);
 const retry=f.owner.retry();expect(f.calls[1].ids).toEqual(['one']);expect(f.owner.retry()).resolves.toBe(false);f.calls[1].resolve();await retry;
 f.owner.dismiss(notice('two',{level:'persistent'}));f.calls[2].reject();await settle();expect(f.owner.visible.map(n=>n.id)).toEqual(['two']);
 const again=f.owner.retry();expect(f.owner.visible).toEqual([]);f.calls[3].resolve();await again;f.owner.dispose();
});
test('offline backpressure caps admitted IDs, and disposing a viewer fences late failures and timers',async()=>{
 const f=fixture();const batch=Array.from({length:200},(_,i)=>notice(String(i),{createdAt:new Date(now-60_000)}));f.owner.mount(batch);expect(f.calls[0].ids).toHaveLength(200);
 f.owner.update([notice('overflow')]);f.owner.dismiss(notice('overflow'));expect(f.owner.visible.map(n=>n.id)).toEqual(['overflow']);expect(f.calls).toHaveLength(1);expect(f.failures).toHaveLength(1);
 f.owner.dispose();expect(f.timers.size).toBe(0);const before=f.failures.length;f.calls[0].reject();await settle();expect(f.failures).toHaveLength(before);expect(f.calls).toHaveLength(1);
});
test('preview hides locally without any API writes',()=>{
 const f=fixture(true);f.owner.mount([notice('normal'),notice('persistent',{level:'persistent'})]);f.expire();f.owner.dismiss(notice('persistent',{level:'persistent'}));expect(f.owner.visible).toEqual([]);expect(f.calls).toEqual([]);f.owner.dispose();
});

test('one request deadline aborts the transport and retries idempotently; refresh failure cannot undo an acknowledged hide',async()=>{
 const f=fixture();f.owner.mount([notice('deadline')]);f.owner.dismiss(notice('deadline'));expect(f.calls[0].signal.aborted).toBe(false);
 f.expire(15000);await settle();expect(f.calls[0].signal.aborted).toBe(true);expect(f.failures).toHaveLength(1);expect(f.owner.visible).toEqual([]);
 const retry=f.owner.retry();expect(f.calls).toHaveLength(2);expect(f.calls[1].signal.aborted).toBe(false);f.calls[1].resolve();await retry;f.owner.dispose();expect(f.timers.size).toBe(0);
 const saved=fixture(false,async()=>{throw Error('Refresh unavailable');});saved.owner.mount([notice('saved')]);saved.owner.dismiss(notice('saved'));saved.calls[0].resolve();await settle();
 expect(saved.failures).toEqual(['saved-refresh-failed']);expect(saved.owner.visible).toEqual([]);expect(saved.owner.retry()).resolves.toBe(false);expect(saved.calls).toHaveLength(1);saved.owner.dispose();
});
test('an auto-expiry refused by backpressure regains a timer when the queued write finishes',async()=>{
 const f=fixture();f.owner.mount(Array.from({length:200},(_,i)=>notice(String(i),{createdAt:new Date(now-60_000)})));
 f.owner.update([notice('later')]);f.expire();expect(f.owner.visible.map(n=>n.id)).toEqual(['later']);expect(f.calls).toHaveLength(1);
 f.calls[0].resolve();await settle();f.expire();expect(f.calls[1].ids).toEqual(['later']);f.owner.dispose();await settle();
});
test('initial old read and already-hidden normal notices cause no persistence or timer work',()=>{
 const f=fixture();f.owner.mount([notice('read',{createdAt:new Date(0),readAt:new Date(now)}),notice('hidden',{createdAt:new Date(0),toastHiddenAt:new Date(now)})]);
 expect(f.owner.visible).toEqual([]);expect(f.calls).toEqual([]);expect(f.timers.size).toBe(0);f.owner.dispose();
});
test('held optional refresh never blocks the bounded write lane or retry and coalesces one follow-up',async()=>{
 const refreshes:{resolve:()=>void;reject:()=>void}[]=[];
 const f=fixture(false,()=>new Promise<void>((resolve,reject)=>refreshes.push({resolve,reject:()=>reject(Error('Held refresh failed'))})));
 f.owner.mount([notice('first')]);f.owner.dismiss(notice('first'));f.calls[0].resolve();await settle();expect(refreshes).toHaveLength(1);
 // A full new window can still be admitted while the first refresh remains unresolved.
 const batch=Array.from({length:200},(_,i)=>notice('next-'+i));f.owner.update(batch);for(const n of batch)f.owner.dismiss(n);
 expect(f.calls[1].ids).toEqual(['next-0']);f.calls[1].resolve();await settle();expect(f.calls[2].ids).toHaveLength(199);
 f.calls[2].reject();await settle();expect(f.failures).toHaveLength(1);const retry=f.owner.retry();expect(f.calls[3].ids).toHaveLength(199);f.calls[3].resolve();await retry;
 expect(refreshes).toHaveLength(1);expect(f.owner.visible).toEqual([]);
 f.owner.update([notice('later',{level:'persistent'})]);f.owner.dismiss(notice('later',{level:'persistent'}));expect(f.calls[4].kind).toBe('dismiss');f.calls[4].resolve();await settle();expect(refreshes).toHaveLength(1);
 refreshes[0].resolve();await settle();expect(refreshes).toHaveLength(2);expect(f.calls).toHaveLength(5);
 refreshes[1].resolve();await settle();expect(refreshes).toHaveLength(2);f.owner.dispose();expect(f.timers.size).toBe(0);
});
test('disposing a viewer drops a held refresh follow-up and fences its late failure',async()=>{
 const refreshes:{reject:()=>void}[]=[];const f=fixture(false,()=>new Promise<void>((_yes,reject)=>refreshes.push({reject:()=>reject(Error('Late refresh'))})));
 f.owner.mount([notice('one')]);f.owner.dismiss(notice('one'));f.calls[0].resolve();await settle();
 f.owner.update([notice('two')]);f.owner.dismiss(notice('two'));f.calls[1].resolve();await settle();expect(refreshes).toHaveLength(1);
 f.owner.dispose();refreshes[0].reject();await settle();expect(f.failures).toEqual([]);expect(refreshes).toHaveLength(1);expect(f.timers.size).toBe(0);
});
