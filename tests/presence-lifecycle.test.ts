import {expect,test} from 'bun:test';
import {compileRunes,moduleUrl} from './fixtures/ui-script';

const source=(await Bun.file(new URL('../src/lib/social/status.svelte.ts',import.meta.url)).text())
 .replace(/^import[^\n]*\n/gm,'')
 .replace(/^export /gm,'');
const {create}=await import(moduleUrl(compileRunes(`export function create(api,refreshRouteDependencies,invalidateContentRevision){${source}\nreturn{userStatus,startPresence,chooseStatus,sharePresence};}`)));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('a stopped presence owner cannot publish or refresh friends after an ignored abort',async()=>{
 const previous={window:globalThis.window,document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{visibilityState:'visible'}),timers=new Set<()=>void>();
 globalThis.window=win as unknown as Window&typeof globalThis;globalThis.document=doc as unknown as Document;
 globalThis.setInterval=((callback:()=>void)=>{timers.add(callback);return callback;})as unknown as typeof setInterval;
 globalThis.clearInterval=((callback:()=>void)=>timers.delete(callback))as unknown as typeof clearInterval;
 let resolve!:(value:unknown)=>void,signal:AbortSignal|undefined,refreshes=0,calls=0;
 const controller=create((_path:unknown,_body:unknown,_method:unknown,options:{signal:AbortSignal})=>{calls++;signal=options.signal;return new Promise(finish=>resolve=finish);},()=>{refreshes++;},()=>{refreshes++;});
 let stop=()=>{};
 try{
  stop=controller.startPresence(()=>false,()=>true);expect(calls).toBe(1);
  for(const tick of timers)tick();expect(calls).toBe(1);
  stop();expect(signal?.aborted).toBe(true);expect(timers.size).toBe(0);
  resolve({preference:'busy',status:'busy',sharePresence:false});await settle();
  expect(controller.userStatus.status).toBe('offline');expect(controller.userStatus.sharePresence).toBe(true);expect(refreshes).toBe(0);
  doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('pointerdown'));expect(calls).toBe(1);
 }finally{stop();Object.assign(globalThis,previous);}
});

test('status and sharing changes use the shared dependency owner while retaining social revisions',async()=>{
 const requests:{path:string;body:unknown}[]=[],refreshes:string[][]=[],revisions:string[][]=[];
 const controller=create(async(path:string,body:unknown)=>{requests.push({path,body});return {preference:'busy',status:'busy',sharePresence:false};},async(dependencies:string[])=>{refreshes.push(dependencies);},(domains:string[])=>{revisions.push(domains);});
 await controller.chooseStatus('busy');await controller.sharePresence(false);
 expect(requests).toEqual([{path:'session/status',body:{preference:'busy'}},{path:'session/presence',body:{enabled:false}}]);
 expect(refreshes).toEqual([['session','social'],['session','social']]);expect(revisions).toEqual([['social'],['social']]);expect(controller.userStatus.busy).toBe(false);
});

test('an interested current heartbeat refreshes friends through the shared owner only after acknowledgement',async()=>{
 const previous={window:globalThis.window,document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 globalThis.window=new EventTarget() as unknown as Window&typeof globalThis;globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'}) as Document;
 globalThis.setInterval=(()=>1) as unknown as typeof setInterval;globalThis.clearInterval=(()=>{}) as unknown as typeof clearInterval;
 const refreshes:string[][]=[],revisions:string[][]=[];
 const controller=create(async()=>({preference:'automatic',status:'online',sharePresence:true}),async(dependencies:string[])=>{refreshes.push(dependencies);},(domains:string[])=>{revisions.push(domains);});
 let stop=()=>{};
 try{stop=controller.startPresence(()=>false,()=>true);await settle();expect(refreshes).toEqual([['social']]);expect(revisions).toEqual([['social']]);}
 finally{stop();Object.assign(globalThis,previous);}
});
