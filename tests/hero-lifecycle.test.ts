import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,svelteUrl} from './fixtures/ui-script';
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(svelteUrl)};export const onMount=()=>{};`);
const stubUrl=moduleUrl(compileRunes(`
 export const page=$state({data:{capabilities:{playback:true,screen:true}},state:{mediaDetailHref:null}});
 export const reader={visible:false},heroPlayer={id:null,url:null,visible:false},player={};
 export const requests=[],presentations=[];
 export const useClient=()=>({api:(path,body,method,options)=>new Promise(resolve=>requests.push({path,signal:options?.signal,resolve}))});
 export const usePlayback=()=>({heroPlayer,player,preview:false});
 export const playbackVisible=()=>false,presentTrailer=(...args)=>presentations.push(args);
 export const heroTitleIds=items=>items.map(item=>item.id),isHeroTitle=()=>true;
`));
const stub=await import(stubUrl);
const source=(await Bun.file(new URL('../src/lib/ui/heroes/presentation.svelte.ts',import.meta.url)).text())
 .replaceAll(/from ['"]svelte['"]/g,`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll(/from ['"]\$app\/state['"]/g,`from ${JSON.stringify(stubUrl)}`)
 .replaceAll(/from ['"]#lib\/[^'"]+['"]/g,`from ${JSON.stringify(stubUrl)}`);
const {createHeroPresentation}=await import(moduleUrl(compileRunes(source)));

test('hero replacement and teardown abort optional trailer lookups and ignore late responses',async()=>{
 const previous={document:globalThis.document,window:globalThis.window,IntersectionObserver:globalThis.IntersectionObserver,ResizeObserver:globalThis.ResizeObserver,
  requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,matchMedia:globalThis.matchMedia,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const timers=new Map<number,()=>void>();let timerId=0;
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){},querySelector(){return null;}} as unknown as Document;
 globalThis.window={addEventListener(){},removeEventListener(){}} as unknown as Window & typeof globalThis;
 globalThis.IntersectionObserver=class{observe(){}disconnect(){}} as unknown as typeof IntersectionObserver;
 globalThis.ResizeObserver=class{observe(){}disconnect(){}} as unknown as typeof ResizeObserver;
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};globalThis.matchMedia=(()=>({matches:false})) as unknown as typeof matchMedia;
 globalThis.setTimeout=((fn:()=>void)=>{timers.set(++timerId,fn);return timerId;}) as unknown as typeof setTimeout;
 globalThis.clearTimeout=((id:number)=>timers.delete(id)) as unknown as typeof clearTimeout;
 const options=runtime.state({item:{id:'title-a',kind:'movie',available:true,title:'A'}});
 let hero:any,dispose=()=>{};
 const runTimers=()=>{const current=[...timers.values()];timers.clear();current.forEach(callback=>callback());};
 const settle=async()=>{for(let i=0;i<6;i++){runtime.flush();await Promise.resolve();}};
 try{
  stub.requests.length=0;stub.presentations.length=0;
  dispose=runtime.effect_root(()=>hero=createHeroPresentation(()=>runtime.get(options)));
  hero.host={getBoundingClientRect:()=>({top:0,left:0,width:100,height:100}),addEventListener(){},removeEventListener(){},closest(){return null;}};
  runtime.flush();runTimers();await settle();expect(stub.requests).toHaveLength(1);expect(stub.requests[0].signal.aborted).toBe(false);
  runtime.set(options,{item:{id:'title-b',kind:'movie',available:true,title:'B'}});await settle();
  expect(stub.requests[0].signal.aborted).toBe(true);
  stub.requests[0].resolve({url:'stale-trailer'});await settle();expect(stub.presentations).toHaveLength(0);
  runTimers();await settle();expect(stub.requests).toHaveLength(2);expect(stub.requests[1].signal.aborted).toBe(false);
  stub.page.state.mediaDetailHref='title-b';await settle();
  expect(stub.requests[1].signal.aborted).toBe(true);runTimers();await settle();expect(stub.requests).toHaveLength(2);
  stub.page.state.mediaDetailHref=null;await settle();
  dispose();expect(stub.requests[1].signal.aborted).toBe(true);expect(timers.size).toBe(0);
  stub.requests[1].resolve({url:'late-trailer'});await settle();expect(stub.presentations).toHaveLength(0);
 }finally{dispose();Object.assign(globalThis,previous);}
});
