import {expect,test} from 'bun:test';
import {providerSingleFlight} from '../src/lib/server/utils/provider-single-flight';
import {queueProviderRequest,requestPriority,providerJob,registerJobRequestPriority,releaseJobRequestPriority,currentRequestPriority} from '../src/lib/server/security/request-priority';

test('a foreground join promotes only the exact shared resource without duplicate provider work',async()=>{
  const origin=crypto.randomUUID(),job=crypto.randomUUID(),order:string[]=[];
  const flight=providerSingleFlight<number>(crypto.randomUUID());
  let release!:()=>void,entered!:()=>void,queued!:()=>void;
  const active=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{queued=resolve;});
  const blocker=queueProviderRequest(origin,0,async()=>{entered();await gate;});await active;
  registerJobRequestPriority(job,3);
  let calls=0;
  try {
    const background=providerJob.run(job,()=>requestPriority.run(3,()=>queueProviderRequest(origin,0,async()=>{order.push('other resource');})));
    const shared=providerJob.run(job,()=>requestPriority.run(3,()=>flight('title:GB',()=>{
      calls++;const response=queueProviderRequest(origin,0,async()=>{order.push('shared title');return 42;});queued();return response;
    })));
    await waiting;
    const joined=requestPriority.run(1,()=>flight('title:GB',async()=>{throw new Error('Duplicate provider request');}));
    expect(joined).toBe(shared);
    release();await blocker;
    expect(await joined).toBe(42);await background;
    expect(order).toEqual(['shared title','other resource']);expect(calls).toBe(1);
  } finally {release();releaseJobRequestPriority(job);}
});

test('a failed flight releases its resource promotion and permits a fresh bounded retry',async()=>{
  const flight=providerSingleFlight<number>(crypto.randomUUID());
  await expect(requestPriority.run(0,()=>flight('same',async()=>{throw new Error('upstream failed');}))).rejects.toThrow('upstream failed');
  expect(await requestPriority.run(3,()=>flight('same',async()=>currentRequestPriority()))).toBe(3);
});
