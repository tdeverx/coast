import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))};export const tick=()=>Promise.resolve();export const callbacks=[];export const onDestroy=fn=>callbacks.push(fn);`);
const lifecycle=await import(lifecycleUrl);
const source=await Bun.file(new URL('../src/lib/ui/shelves/layout.svelte.ts',import.meta.url)).text();
const code=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'layout.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client')).replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`).replaceAll('../shelf-position',import.meta.resolve('../src/lib/ui/shelf-position'));
const {createShelfLayout}:typeof import('../src/lib/ui/shelves/layout.svelte')=await import(moduleUrl(code));
test('rail scroll/observer bursts share one frame and cannot publish after disposal',async()=>{
 const oldRAF=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame,oldResize=globalThis.ResizeObserver,oldMutation=globalThis.MutationObserver,oldMatch=globalThis.matchMedia;
 let nextFrame=0,reads=0,disconnected=0,observers=0,ends=0;const frames=new Map<number,FrameRequestCallback>();let observerSchedule!:()=>void;
 globalThis.requestAnimationFrame=callback=>{frames.set(++nextFrame,callback);return nextFrame;};
 globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 globalThis.ResizeObserver=class{constructor(callback:()=>void){observers++;observerSchedule=callback;}observe(){}disconnect(){disconnected++;}} as unknown as typeof ResizeObserver;
 globalThis.MutationObserver=class{constructor(){observers++;}observe(){}disconnect(){disconnected++;}} as unknown as typeof MutationObserver;
 globalThis.matchMedia=(()=>({matches:true})) as unknown as typeof matchMedia;
 const calls:ScrollToOptions[]=[];
 const scroller={scrollLeft:1000,get clientWidth(){reads++;return 500;},get scrollWidth(){reads++;return 1500;},scrollBy:(options:ScrollToOptions)=>calls.push(options)} as unknown as HTMLDivElement;
 const busy=runtime.state(false);let rail!:ReturnType<typeof createShelfLayout>;
 const dispose=runtime.effect_root(()=>rail=createShelfLayout(()=>({size:'poster',artworkStyle:'auto',overlay:'none',layout:'row',busy:runtime.get(busy),preserveHeight:false,hasMore:true,onend:()=>{ends++;runtime.set(busy,true);}})));
 const settle=async()=>{for(let i=0;i<5;i++){runtime.flush();await Promise.resolve();}};
 const runFrame=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(0));};
 try{
  await settle();rail.scroller=scroller;await settle();runFrame();await settle();runFrame();rail.scroller!.scrollLeft=1000;reads=0;ends=0;
  for(let i=0;i<100;i++){rail.reachedEnd();observerSchedule();}
  expect(frames.size).toBe(1);expect(reads).toBe(0);runFrame();
  expect(reads).toBe(2);expect(ends).toBe(1);expect(rail.previous).toBe(true);expect(rail.next).toBe(false);
  rail.reachedEnd();runFrame();expect(ends).toBe(1);
  runtime.set(busy,false);await settle();rail.scroll(-1);expect(calls[0]).toEqual({left:-400,behavior:'instant'});
  rail.reachedEnd();expect(frames.size).toBe(1);
  const stale=[...frames.values()];
  lifecycle.callbacks.splice(0).forEach((cleanup:()=>void)=>cleanup());dispose();
  const before=reads;stale.forEach(fn=>fn(0));await settle();expect(reads).toBe(before);expect(frames.size).toBe(0);expect(disconnected).toBe(observers);
 }finally{
  lifecycle.callbacks.splice(0).forEach((cleanup:()=>void)=>cleanup());dispose();
  globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;globalThis.ResizeObserver=oldResize;globalThis.MutationObserver=oldMutation;globalThis.matchMedia=oldMatch;
 }
});

test('server-rendered shelves destroy safely without browser animation APIs', async () => {
 const serverCode=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'layout.svelte.js',generate:'server'}).js.code
  .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`).replaceAll('../shelf-position',import.meta.resolve('../src/lib/ui/shelf-position'));
 const server=await import(moduleUrl(serverCode));
 const previous=globalThis.cancelAnimationFrame;
 try {
  // Server rendering runs onDestroy, but never schedules a browser frame.
  globalThis.cancelAnimationFrame=undefined as unknown as typeof cancelAnimationFrame;
  server.createShelfLayout(()=>({size:'poster',artworkStyle:'auto',overlay:'none',layout:'row',busy:false,preserveHeight:false,hasMore:false}));
  expect(()=>lifecycle.callbacks.splice(0).forEach((cleanup:()=>void)=>cleanup())).not.toThrow();
 } finally {globalThis.cancelAnimationFrame=previous;}
});

test('anchored rails snap once, retain browsing on append, and preserve position when earlier pages arrive',async()=>{
 const savedDocument=globalThis.document;globalThis.document={activeElement:null} as unknown as Document;
 const saved={raf:globalThis.requestAnimationFrame,cancel:globalThis.cancelAnimationFrame,resize:globalThis.ResizeObserver,mutation:globalThis.MutationObserver,style:globalThis.getComputedStyle};
 const frames=new Map<number,FrameRequestCallback>();let frame=0,previousLoads=0,finishPrevious!:()=>void,widthWrites=0;
 globalThis.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}} as unknown as typeof ResizeObserver;
 globalThis.MutationObserver=class{observe(){}disconnect(){}} as unknown as typeof MutationObserver;
 globalThis.getComputedStyle=(()=>({scrollPaddingLeft:'20px'})) as unknown as typeof getComputedStyle;
 const options=runtime.state({busy:false,key:'first',focus:undefined as string|undefined,hasPrevious:true,items:['earlier','next','later']});
 const nodes=[{id:'earlier',offset:0},{id:'next',offset:400},{id:'later',offset:800}].map(item=>({...item,dataset:{shelfId:item.id,shelfKey:item.id},isConnected:true,getBoundingClientRect(){return {left:10+this.offset-scroller.scrollLeft,right:390+this.offset-scroller.scrollLeft};}}));
 const scroller=new class {
  scrollLeft=0;clientWidth=500;scrollWidth=2000;style={setProperty(){widthWrites++;}};lastElementChild=nodes.at(-1);
  getBoundingClientRect(){return {left:10,right:510};}querySelector(){return nodes[0];}querySelectorAll(){return nodes;}scrollBy(){}
 }() as unknown as HTMLDivElement;
 let rail!:ReturnType<typeof createShelfLayout>;
 const dispose=runtime.effect_root(()=>rail=createShelfLayout(()=>({size:'fanart',artworkStyle:'thumb',overlay:'none',layout:'row',preserveHeight:false,hasMore:false,busy:runtime.get(options).busy,resetKey:runtime.get(options).key,initialItemId:runtime.get(options).focus,items:runtime.get(options).items,hasPrevious:runtime.get(options).hasPrevious,onstart:()=>{previousLoads++;return new Promise<void>(resolve=>finishPrevious=resolve);}})));
 const settle=async()=>{for(let i=0;i<8;i++){runtime.flush();await Promise.resolve();const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(0));}};
 try{
  rail.scroller=scroller;await settle();expect(widthWrites).toBe(0);
  runtime.set(options,{...runtime.get(options),focus:'next'});await settle();expect(scroller.scrollLeft).toBe(380);expect(widthWrites).toBe(1);
  scroller.scrollLeft=600;rail.reachedEnd();await settle();expect(scroller.scrollLeft).toBe(600);
  // An unchanged focus does not snap the user back after ordinary row changes.
  runtime.set(options,{...runtime.get(options),busy:true});await settle();runtime.set(options,{...runtime.get(options),busy:false});await settle();expect(scroller.scrollLeft).toBe(600);
  scroller.scrollLeft=0;rail.reachedEnd();await settle();expect(previousLoads).toBe(1);
  rail.scroll(-1);expect(previousLoads).toBe(1);
  runtime.set(options,{...runtime.get(options),items:[...runtime.get(options).items]});runtime.flush();
  nodes.forEach(node=>node.offset+=1200);finishPrevious();await settle();expect(scroller.scrollLeft).toBe(1200);
  runtime.set(options,{...runtime.get(options),key:'tracking-refresh'});await settle();expect(scroller.scrollLeft).toBe(1580);
  // A pending prepend cannot move a rail after ownership ends.
  scroller.scrollLeft=0;rail.reachedEnd();await settle();expect(previousLoads).toBe(2);
  lifecycle.callbacks.splice(0).forEach((fn:()=>void)=>fn());dispose();nodes.forEach(node=>node.offset+=1200);finishPrevious();await settle();expect(scroller.scrollLeft).toBe(0);
 }finally{
  lifecycle.callbacks.splice(0).forEach((fn:()=>void)=>fn());dispose();
  globalThis.document=savedDocument;
  globalThis.requestAnimationFrame=saved.raf;globalThis.cancelAnimationFrame=saved.cancel;globalThis.ResizeObserver=saved.resize;globalThis.MutationObserver=saved.mutation;globalThis.getComputedStyle=saved.style;
 }
});

// Geometry/lifetime controls supplement the signed-in real-catalogue scrolling proof.
test('grid geometry recovers a missed sentinel edge, gates busy/errors and releases its scroll owner',async()=>{
 const saved={document:globalThis.document,style:globalThis.getComputedStyle,raf:globalThis.requestAnimationFrame,cancel:globalThis.cancelAnimationFrame,resize:globalThis.ResizeObserver,mutation:globalThis.MutationObserver};
 const frames=new Map<number,FrameRequestCallback>(),listeners=new Set<()=>void>();let frame=0,loads=0;
 const priorHeight=Object.getOwnPropertyDescriptor(globalThis,'innerHeight');Object.defineProperty(globalThis,'innerHeight',{configurable:true,value:600});
 const viewport={scrollTop:0,hasAttribute:()=>false,getBoundingClientRect:()=>({top:0,bottom:600}),addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn)};
 const node={parentElement:viewport,clientWidth:400,scrollWidth:400,scrollLeft:0,getBoundingClientRect:()=>({top:0,bottom:500})} as unknown as HTMLDivElement;
 globalThis.document={scrollingElement:{}} as unknown as Document;
 globalThis.getComputedStyle=(()=>({overflowY:'auto'})) as unknown as typeof getComputedStyle;
 globalThis.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}} as unknown as typeof ResizeObserver;
 globalThis.MutationObserver=class{observe(){}disconnect(){}} as unknown as typeof MutationObserver;
 const flags=runtime.state({busy:true,error:''});let rail:any;
 const dispose=runtime.effect_root(()=>rail=createShelfLayout(()=>({size:'poster',artworkStyle:'auto',overlay:'none',layout:'grid',busy:runtime.get(flags).busy,error:runtime.get(flags).error,preserveHeight:false,hasMore:true,autoLoad:true,onend:()=>{loads++;runtime.set(flags,{busy:true,error:''});}})));
 const settle=async()=>{for(let i=0;i<5;i++){runtime.flush();await Promise.resolve();}};
 const draw=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(0));};
 try{
  // A sentinel intersected during a pending read and delivered no later edge.
  rail.scroller=node;await settle();draw();expect(loads).toBe(0);expect(listeners.size).toBe(1);
  runtime.set(flags,{busy:false,error:''});await settle();draw();expect(loads).toBe(1);
  for(let i=0;i<100;i++)for(const fn of listeners)fn();expect(frames.size).toBe(1);draw();expect(loads).toBe(1);
  runtime.set(flags,{busy:false,error:'Retry required'});await settle();draw();expect(loads).toBe(1);
  runtime.set(flags,{busy:true,error:''});await settle();runtime.set(flags,{busy:false,error:''});await settle();draw();expect(loads).toBe(2);
  dispose();for(const cleanup of lifecycle.callbacks.splice(0))cleanup();expect(listeners.size).toBe(0);
 }finally{
  dispose();for(const cleanup of lifecycle.callbacks.splice(0))cleanup();
  if(priorHeight)Object.defineProperty(globalThis,'innerHeight',priorHeight);else Reflect.deleteProperty(globalThis,'innerHeight');
  globalThis.document=saved.document;globalThis.getComputedStyle=saved.style;globalThis.requestAnimationFrame=saved.raf;globalThis.cancelAnimationFrame=saved.cancel;globalThis.ResizeObserver=saved.resize;globalThis.MutationObserver=saved.mutation;
 }
});
