import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type {listBenchmarks} from '../src/lib/benchmarks/service.server';
type History=Awaited<ReturnType<typeof listBenchmarks>>;
const moduleUrl=(code:string)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile=(source:string,name:string)=>compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:name,generate:'client'}).js.code
 .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));
const resource=compile(await Bun.file(new URL('../src/lib/ui/resource.svelte.ts',import.meta.url)).text(),'resource.svelte.js');
// Run the real component script/runes with only DOM lifecycle and transport as
// boundaries. The coordinator separately verifies the rendered component.
const component=await Bun.file(new URL('../src/lib/benchmarks/BenchmarkSettings.svelte',import.meta.url)).text();
const script=component.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1]
 .replace(/^\s*import .*?;\s*$/gm,'')
 .replace('let {history}:{history:Awaited<ReturnType<typeof listBenchmarks>>}=$props();','let history=$state(initial);');
const harness=compile(`import {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))};
 import {createResource} from ${JSON.stringify(moduleUrl(resource))};
 export function createBenchmarkSettings(initial,transport,inPreview=false){
 const mounts=[];const onMount=callback=>mounts.push(callback);const message=error=>error.message;
 const reportFailure=()=>{};const useClient=()=>({api:transport,preview:inPreview});const goto=()=>{throw new Error('Unexpected real navigation');};
 ${script}
 return {get current(){return current;},get busy(){return busy;},get error(){return error;},setHistory(next){history=next;},run,changePage,mount(){const cleanups=mounts.map(callback=>callback());return ()=>cleanups.forEach(cleanup=>cleanup?.());}};
 }`,'benchmark-settings.svelte.js');
const {createBenchmarkSettings}=await import(moduleUrl(harness));
const history=(page=1,active=true):History=>({runs:[],total:40,page,pages:2,activeId:active?'synthetic-active':null});
function pending(){let resolve!:(value:History)=>void,reject!:(reason:Error)=>void;const promise=new Promise<History>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('benchmark polling aborts stale pages and teardown and never publishes late results',async()=>{
 const oldDocument=globalThis.document,oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval;
 const timers=new Set<()=>void>();let controller:any,cleanup=()=>{};
 const requests:{path:string;signal:AbortSignal;pending:ReturnType<typeof pending>}[]=[];
 const doc={hidden:false};globalThis.document=doc as Document;
 globalThis.setInterval=((callback:()=>void)=>{timers.add(callback);return callback;}) as unknown as typeof setInterval;
 globalThis.clearInterval=((callback:()=>void)=>timers.delete(callback)) as unknown as typeof clearInterval;
 const dispose=runtime.effect_root(()=>controller=createBenchmarkSettings(history(),(path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  const request={path,signal:options.signal,pending:pending()};requests.push(request);return request.pending.promise;
 }));
 try{
  runtime.flush();cleanup=controller.mount();const tick=()=>[...timers][0]();
  tick();tick();expect(requests).toHaveLength(1);
  controller.setHistory(history(2));runtime.flush();expect(requests[0].signal.aborted).toBe(true);
  tick();expect(requests).toHaveLength(2);expect(requests[1].path).toContain('page=2');
  requests[0].pending.resolve(history(1));await Promise.resolve();await Promise.resolve();expect(controller.current.page).toBe(2);
  requests[1].pending.resolve(history(2));await Promise.resolve();await Promise.resolve();
  doc.hidden=true;tick();expect(requests).toHaveLength(2);doc.hidden=false;
  tick();expect(requests).toHaveLength(3);cleanup();expect(timers.size).toBe(0);expect(requests[2].signal.aborted).toBe(true);
  requests[2].pending.resolve(history(1));await Promise.resolve();await Promise.resolve();expect(controller.current.page).toBe(2);
 }finally{cleanup();dispose();globalThis.document=oldDocument;globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;}
});

test('benchmark queue requests cannot refresh a superseded page after navigation',async()=>{
 const requests:{method:string;signal:AbortSignal;pending:ReturnType<typeof pending>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createBenchmarkSettings(history(1,false),(_path:string,_body:unknown,method:string,options:{signal:AbortSignal})=>{
  const request={method,signal:options.signal,pending:pending()};requests.push(request);return request.pending.promise;
 }));
 try{
  runtime.flush();const queued=controller.run();expect(requests[0].method).toBe('POST');
  controller.setHistory(history(2,false));runtime.flush();expect(requests[0].signal.aborted).toBe(true);
  requests[0].pending.resolve(history(1));await queued;expect(requests).toHaveLength(1);expect(controller.current.page).toBe(2);expect(controller.busy).toBe(false);
 }finally{dispose();}
});

test('benchmark preview has no polling owner and queues and pages through its injected client',async()=>{
 const calls:{path:string;method:string}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createBenchmarkSettings(history(1,false),async(path:string,_body:unknown,method:string)=>{
  calls.push({path,method});return history(path.endsWith('page=2')?2:1,false);
 },true));
 const oldInterval=globalThis.setInterval;
 let cleanup=()=>{};
 globalThis.setInterval=(()=>{throw Error('Preview must not poll');}) as unknown as typeof setInterval;
 try{
  runtime.flush();cleanup=controller.mount();expect(calls).toHaveLength(0);
  await controller.run();expect(calls).toEqual([{path:'admin/benchmarks',method:'POST'},{path:'admin/benchmarks?page=1',method:'GET'}]);
  await controller.changePage(2);expect(calls.at(-1)).toEqual({path:'admin/benchmarks?page=2',method:'GET'});expect(controller.current.page).toBe(2);
 }finally{cleanup();dispose();globalThis.setInterval=oldInterval;}
});
