import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))};export const tick=()=>Promise.resolve();export const callbacks=[];export const onDestroy=fn=>callbacks.push(fn);`);
const lifecycle=await import(lifecycleUrl);
const source=await Bun.file(new URL('../src/lib/ui/shelves/layout.svelte.ts',import.meta.url)).text();
const code=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'layout.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client')).replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`);
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
