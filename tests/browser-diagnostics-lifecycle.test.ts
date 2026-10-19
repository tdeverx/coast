import {expect,test} from 'bun:test';
import {moduleUrl} from './fixtures/ui-script';

const original=(await Bun.file(new URL('../src/lib/ui/diagnostics.ts',import.meta.url)).text())
 .replace("from '$lib/diagnostics'",`from ${JSON.stringify(import.meta.resolve('../src/lib/diagnostics'))}`);
const {installBrowserDiagnostics,browserDiagnostic}=await import(moduleUrl(new Bun.Transpiler({loader:'ts'}).transformSync(original)));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('diagnostic polling has one visible request, resumes once, aborts teardown and ignores late replies',async()=>{
 const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{hidden:false}),timers=new Set<()=>void>();
 const requests:{signal?:AbortSignal|null;finish:(response:Response)=>void}[]=[];
 globalThis.window=win as unknown as Window&typeof globalThis;globalThis.document=doc as unknown as Document;
 globalThis.setInterval=((callback:()=>void)=>{timers.add(callback);return callback;})as unknown as typeof setInterval;
 globalThis.clearInterval=((callback:()=>void)=>timers.delete(callback))as unknown as typeof clearInterval;
 globalThis.fetch=((_input:unknown,init?:RequestInit)=>new Promise<Response>(finish=>requests.push({signal:init?.signal,finish})))as typeof fetch;
 let stop=()=>{};
 try{
  stop=installBrowserDiagnostics();expect(requests).toHaveLength(1);
  const tick=()=>[...timers].forEach(callback=>callback());
  for(let i=0;i<20;i++)tick();expect(requests).toHaveLength(1);
  requests[0].finish(new Response(null,{headers:{'x-coast-diagnostic-level':'off'}}));await settle();
  doc.hidden=true;for(let i=0;i<20;i++)tick();expect(requests).toHaveLength(1);
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(requests).toHaveLength(2);
  stop();expect(requests[1].signal?.aborted).toBe(true);expect(timers.size).toBe(0);
  requests[1].finish(new Response(null,{headers:{'x-coast-diagnostic-level':'trace'}}));await settle();
  browserDiagnostic('browser.error');expect(requests).toHaveLength(2);
  doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('error'));tick();expect(requests).toHaveLength(2);
 }finally{stop();Object.assign(globalThis,previous);}
});
