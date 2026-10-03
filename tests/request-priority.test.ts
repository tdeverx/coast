import {test,expect} from 'bun:test';
import {queueProviderRequest,requestPriority} from '../src/lib/server/security/request-priority';
test('requests serialize and urgent work slots between background requests',async()=>{
 const origin=crypto.randomUUID(),order:string[]=[];
 let release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const first=requestPriority.run(3,()=>queueProviderRequest(origin,0,async()=>{order.push('first');entered();await gate;}));await ready;
 const background=requestPriority.run(3,()=>queueProviderRequest(origin,0,async()=>{order.push('background');}));
 const interactive=requestPriority.run(1,()=>queueProviderRequest(origin,0,async()=>{order.push('interactive');}));
 const initial=requestPriority.run(0,()=>queueProviderRequest(origin,0,async()=>{order.push('initial');}));
 release();await Promise.all([first,background,interactive,initial]);expect(order).toEqual(['first','initial','interactive','background']);
});
test('cancelled queued requests never call the provider',async()=>{
 const origin=crypto.randomUUID(),controller=new AbortController();let release!:()=>void,called=false;
 const first=queueProviderRequest(origin,0,()=>new Promise<void>(r=>release=r));
 const next=queueProviderRequest(origin,0,async()=>{called=true;},controller.signal);
 controller.abort(new Error('cancelled'));await expect(next).rejects.toThrow('cancelled');release();await first;expect(called).toBe(false);
});
test('queued calls retain their own task context',async()=>{
 const origin=crypto.randomUUID();let release!:()=>void;
 const first=requestPriority.run(3,()=>queueProviderRequest(origin,0,()=>new Promise<void>(r=>release=r)));
 const next=requestPriority.run(0,()=>queueProviderRequest(origin,0,async()=>requestPriority.getStore()));release();await first;expect(await next).toBe(0);
});
