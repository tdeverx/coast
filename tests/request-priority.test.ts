import {test,expect} from 'bun:test';
import {queueProviderRequest,requestPriority,providerJob,registerJobRequestPriority,updateJobRequestPriority,releaseJobRequestPriority} from '../src/lib/server/security/request-priority';
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

test('promoting an active job reorders its already queued HTTP request',async()=>{
 const origin=crypto.randomUUID(),id=crypto.randomUUID(),order:string[]=[];
 let release!:()=>void;
 const active=queueProviderRequest(origin,0,()=>new Promise<void>(resolve=>release=resolve));
 registerJobRequestPriority(id,3);
 try{
  const promoted=providerJob.run(id,()=>requestPriority.run(3,()=>queueProviderRequest(origin,0,async()=>{order.push('promoted');})));
  const live=requestPriority.run(2,()=>queueProviderRequest(origin,0,async()=>{order.push('live');}));
  updateJobRequestPriority(id,1);
  release();await Promise.all([active,promoted,live]);
  expect(order).toEqual(['promoted','live']);
 }finally{releaseJobRequestPriority(id);}
});

test('background admission reserves per-origin slots for urgent calls and releases cancelled ownership',async()=>{
 const {ProviderQueueBusyError,providerRequestLimits:limits,providerRequestMetrics}=await import('../src/lib/server/security/request-priority');
 const origin=crypto.randomUUID(),controllers:AbortController[]=[],pending:Promise<unknown>[]=[];let release!:()=>void,calls=0;
 const first=queueProviderRequest(origin,0,()=>new Promise<void>(r=>release=r));
 const enqueue=(priority:0|3)=>{const controller=new AbortController();controllers.push(controller);pending.push(requestPriority.run(priority,()=>queueProviderRequest(origin,0,async()=>{calls++;},controller.signal)).catch(error=>error));};
 try{
  for(let i=0;i<limits.perOrigin-limits.urgentPerOrigin;i++)enqueue(3);
  const rejected=await requestPriority.run(3,()=>queueProviderRequest(origin,0,async()=>{calls++;})).catch(error=>error);
  expect(rejected).toBeInstanceOf(ProviderQueueBusyError);expect(rejected).toMatchObject({status:503,code:'provider_queue_busy'});
  for(let i=0;i<limits.urgentPerOrigin;i++)enqueue(0);
  await expect(requestPriority.run(0,()=>queueProviderRequest(origin,0,async()=>{calls++;}))).rejects.toBeInstanceOf(ProviderQueueBusyError);
  expect(providerRequestMetrics().providerWaiting).toBe(limits.perOrigin);
 }finally{for(const c of controllers)c.abort();release();await Promise.all([first,...pending]);}
 expect(calls).toBe(0);expect(providerRequestMetrics().providerOutstanding).toBe(0);
 // Released admission can be reused immediately.
 await queueProviderRequest(origin,0,async()=>{calls++;});expect(calls).toBe(1);
});

test('global admission counts running work and reserves urgent capacity across origins',async()=>{
 const {ProviderQueueBusyError,providerRequestLimits:limits,providerRequestMetrics}=await import('../src/lib/server/security/request-priority');
 const releases:(()=>void)[]=[],controllers:AbortController[]=[],pending:Promise<unknown>[]=[];
 const origins=Array.from({length:5},()=>crypto.randomUUID());let calls=0;
 const queue=(origin:string,priority:0|3,active=false)=>{
  const controller=new AbortController();controllers.push(controller);
  pending.push(requestPriority.run(priority,()=>queueProviderRequest(origin,0,async()=>{
   if(active)await new Promise<void>(r=>releases.push(r));else calls++;
  },controller.signal)).catch(error=>error));
 };
 try{
  for(const origin of origins){queue(origin,3,true);for(let i=1;i<96;i++)queue(origin,3);}
  expect(providerRequestMetrics().providerOutstanding).toBe(limits.overall-limits.urgentOverall);
  await expect(requestPriority.run(3,()=>queueProviderRequest(crypto.randomUUID(),0,async()=>{calls++;}))).rejects.toBeInstanceOf(ProviderQueueBusyError);
  for(let i=0;i<limits.urgentOverall;i++)queue(origins[i%origins.length],0);
  expect(providerRequestMetrics().providerOutstanding).toBe(limits.overall);
  await expect(queueProviderRequest(crypto.randomUUID(),0,async()=>{calls++;})).rejects.toBeInstanceOf(ProviderQueueBusyError);
 }finally{for(const c of controllers)c.abort();for(const release of releases)release();await Promise.all(pending);}
 expect(calls).toBe(0);expect(providerRequestMetrics().providerOutstanding).toBe(0);
});

test('idle lanes expire after pacing, while reusing a lane retains its cooldown',async()=>{
 const {deferProviderRequests,providerRequestMetrics}=await import('../src/lib/server/security/request-priority');
 const origins=providerRequestMetrics().providerOrigins,origin=crypto.randomUUID();
 const order:string[]=[];let release!:()=>void;
 const first=queueProviderRequest(origin,5,()=>new Promise<void>(r=>release=r));
 deferProviderRequests(origin,25);
 const second=queueProviderRequest(origin,0,async()=>{order.push('second');});
 release();await first;
 expect(order).toEqual([]);expect(providerRequestMetrics().providerOrigins).toBe(origins+1);
 await second;expect(order).toEqual(['second']);
 await Bun.sleep(10);expect(providerRequestMetrics().providerOrigins).toBe(origins);
});

test('an entirely cancelled cooldown wait releases its waiting timer without losing the cooldown',async()=>{
 const {deferProviderRequests,providerRequestMetrics}=await import('../src/lib/server/security/request-priority');
 const origin=crypto.randomUUID();let release!:()=>void;
 const active=queueProviderRequest(origin,0,()=>new Promise<void>(r=>release=r));
 deferProviderRequests(origin,30);
 const controller=new AbortController();let called=false;
 const cancelled=queueProviderRequest(origin,0,async()=>{called=true;},controller.signal);
 release();await active;controller.abort();await expect(cancelled).rejects.toBeDefined();
 expect(providerRequestMetrics().providerOutstanding).toBe(0);
 const next=queueProviderRequest(origin,0,async()=>{called=true;});expect(called).toBe(false);await next;expect(called).toBe(true);
});

test('reserved urgent admission keeps oldest background work progressing between urgent bursts',async()=>{
 const origin=crypto.randomUUID(),order:string[]=[];let release!:()=>void;
 const active=queueProviderRequest(origin,0,()=>new Promise<void>(r=>release=r));
 const background=requestPriority.run(3,()=>queueProviderRequest(origin,0,async()=>{order.push('background');}));
 const urgent=Array.from({length:10},(_,index)=>requestPriority.run(0,()=>queueProviderRequest(origin,0,async()=>{order.push(`urgent-${index}`);})));
 release();await Promise.all([active,background,...urgent]);
 expect(order.slice(0,8)).toEqual(Array.from({length:8},(_,index)=>`urgent-${index}`));
 expect(order[8]).toBe('background');
});

test('queue wait expires independently of provider I/O and releases admission',async()=>{
 const {ProviderQueueTimeoutError,providerRequestMetrics}=await import('../src/lib/server/security/request-priority');
 const origin=crypto.randomUUID();let release!:()=>void,called=false;
 const running=queueProviderRequest(origin,0,()=>new Promise<void>(r=>release=r));
 try{
  const queued=queueProviderRequest(origin,0,async()=>{called=true;},undefined,20);
  await expect(queued).rejects.toBeInstanceOf(ProviderQueueTimeoutError);
  expect(called).toBe(false);expect(providerRequestMetrics().providerWaiting).toBe(0);
 }finally{release();await running;}
 await queueProviderRequest(origin,0,async()=>{called=true;});expect(called).toBe(true);
});

test('queue deadline is cleared on admission and does not time out active work',async()=>{
 let release!:()=>void;const origin=crypto.randomUUID();
 const request=queueProviderRequest(origin,0,()=>new Promise<string>(r=>release=()=>r('completed')),undefined,10);
 await Bun.sleep(25);release();expect(await request).toBe('completed');
});
