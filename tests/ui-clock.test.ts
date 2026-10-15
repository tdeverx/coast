import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {activityDateLabel} from '../src/lib/social/model';
const source=await Bun.file(new URL('../src/lib/ui/clock.svelte.ts',import.meta.url)).text();
const compiled=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'clock.svelte.js',generate:'client'}).js.code
 .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'))
 .replaceAll('from "svelte"',`from ${JSON.stringify(import.meta.resolve('svelte'))}`);
const {useClock}:typeof import('../src/lib/ui/clock.svelte')=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('shared clocks retain visible second precision, keep dates coarse, and release hidden/disposed subscriptions',()=>{
 const oldDocument=globalThis.document,oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval,oldNow=Date.now;
 const timers=new Map<number,{callback:()=>void;interval:number}>();let id=0,time=10000;
 const listeners=new Set<EventListenerOrEventListenerObject>();
 const document=new EventTarget() as EventTarget & {hidden:boolean};document.hidden=false;
 const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
 document.addEventListener=(type,callback,options)=>{if(callback&&type==='visibilitychange')listeners.add(callback);add(type,callback,options);};
 document.removeEventListener=(type,callback,options)=>{if(callback&&type==='visibilitychange')listeners.delete(callback);remove(type,callback,options);};
 globalThis.document=document as unknown as Document;
 globalThis.setInterval=((callback:()=>void,interval:number)=>{timers.set(++id,{callback,interval});return id;}) as unknown as typeof setInterval;
 globalThis.clearInterval=((timer:number)=>{timers.delete(timer);}) as unknown as typeof clearInterval;
 Date.now=()=>time;
 let second!:ReturnType<typeof useClock>,minute!:ReturnType<typeof useClock>;
 const enabled=runtime.state(false);
 const disposeSecond=runtime.effect_root(()=>second=useClock());
 const disposeAnotherSecond=runtime.effect_root(()=>useClock());
 const disposeMinute=runtime.effect_root(()=>minute=useClock('minute',()=>runtime.get(enabled)));
 try{
  runtime.flush();expect(timers.size).toBe(1);expect(listeners.size).toBe(1);
  runtime.set(enabled,true);runtime.flush();expect(timers.size).toBe(2);
  expect([...timers.values()].map(timer=>timer.interval).sort((a,b)=>a-b)).toEqual([1000,60000]);
  time=11000;[...timers.values()].find(timer=>timer.interval===1000)!.callback();
  expect(second.now).toBe(11000);expect(minute.now).toBe(10000);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));expect(timers.size).toBe(0);
  time=200000;expect(second.now).toBe(11000);expect(minute.now).toBe(10000);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));
  expect(second.now).toBe(200000);expect(minute.now).toBe(200000);expect(timers.size).toBe(2);
  runtime.set(enabled,false);runtime.flush();expect(timers.size).toBe(1);expect(listeners.size).toBe(1);
  disposeSecond();expect(timers.size).toBe(1);
  disposeAnotherSecond();expect(timers.size).toBe(0);expect(listeners.size).toBe(0);
 }finally{
  disposeMinute();disposeSecond();disposeAnotherSecond();
  globalThis.document=oldDocument;globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;Date.now=oldNow;
 }
});
test('relative dates preserve minute/day/year meanings with bounded locale formatter reuse',()=>{
 const now=Date.parse('2026-10-15T12:00:00Z');
 expect(activityDateLabel(new Date(now-59000).toISOString(),now,'en-GB')).toBe('Just now');
 expect(activityDateLabel(new Date(now-60000).toISOString(),now,'en-GB')).toBe('1m ago');
 expect(activityDateLabel(new Date(now-3600000).toISOString(),now,'en-GB')).toBe('1h ago');
 expect(activityDateLabel(new Date(now-86400000).toISOString(),now,'en-GB')).toBe('1d ago');
 expect(activityDateLabel('2026-10-01T12:00:00Z',now,'en-GB')).toBe('1 Oct');
 expect(activityDateLabel('2025-10-01T12:00:00Z',now,'en-GB')).toBe('1 Oct 2025');
 expect(activityDateLabel('2026-10-01T12:00:00Z',now,'fr-FR')).toBe(new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short'}).format(new Date('2026-10-01T12:00:00Z')));
 const Original=Intl.DateTimeFormat;let constructions=0;
 Intl.DateTimeFormat=function(...args:ConstructorParameters<typeof Intl.DateTimeFormat>){constructions++;return new Original(...args);} as unknown as typeof Intl.DateTimeFormat;
 try{
  for(let second=0;second<60;second++)activityDateLabel('2026-10-01T12:00:00Z',now+second*1000,'en-GB');
  expect(constructions).toBe(2);
 }finally{Intl.DateTimeFormat=Original;}
});
