import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type {ForYouOptions} from '../src/lib/ui/shelves/for-you.svelte';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile=async(path:string)=>compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(new URL(path,import.meta.url)).text()),{filename:'fixture.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));
const resourceUrl=moduleUrl(await compile('../src/lib/ui/resource.svelte.ts'));
const revisionUrl=moduleUrl(await compile('../src/lib/ui/content-revision.svelte.ts'));
const routeUrl=moduleUrl(compileModule('export const page=$state({data:{user:{id:"viewer"},contentRevision:{tracking:"one",social:"one",planning:"one"},experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,experiments:{planning:true}},url:new URL("http://fixture/for-you"),state:{}});',{filename:'route.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client')));
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};const hooks=[];export const onDestroy=callback=>hooks.push(callback);export const destroy=()=>hooks.splice(0).forEach(callback=>callback());`);
const clientUrl=moduleUrl('export let delivery;export const setDelivery=next=>delivery=next;export const useClient=()=>({api:(...args)=>delivery(...args)});export class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}');
const navigationUrl=moduleUrl('export const replaceState=()=>{};');
const client=await import(clientUrl),{page}=await import(routeUrl),lifecycle=await import(lifecycleUrl);
const {createForYouSource}:typeof import('../src/lib/ui/shelves/for-you.svelte')=await import(moduleUrl((await compile('../src/lib/ui/shelves/for-you.svelte.ts'))
 .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll('$app/state',routeUrl).replaceAll('$app/navigation',navigationUrl)
 .replaceAll('$lib/ui/client-context',clientUrl).replaceAll('$lib/ui/resource.svelte',resourceUrl)
 .replaceAll('$lib/ui/content-revision.svelte',revisionUrl).replaceAll('$lib/ui/client',clientUrl)
 .replaceAll('$lib/recommendations/row-titles',import.meta.resolve('../src/lib/recommendations/row-titles'))
 .replaceAll('$lib/experimental',import.meta.resolve('../src/lib/experimental'))));
const settle=async()=>{for(let index=0;index<10;index++){runtime.flush();await Promise.resolve();}};
const content=(id='old')=>({items:[{id,title:id,kind:'album'} as any],total:1,page:1,pages:1,title:undefined});
function fixture(option:Partial<ForYouOptions>={}){
 page.data.user={id:'viewer'};page.data.contentRevision={tracking:'one',social:'one',planning:'one'};
 page.data.experimentalMusic=true;page.data.experimentalBooks=true;page.data.experimentalComics=true;page.data.experiments.planning=true;
 const options=runtime.state({type:'for-you',feature:'recommendations',category:'music',...option} as ForYouOptions);
 let source!:ReturnType<typeof createForYouSource>;
 const dispose=runtime.effect_root(()=>source=createForYouSource(()=>runtime.get(options)));runtime.flush();
 return {source,update:(patch:Partial<ForYouOptions>)=>{runtime.set(options,{...runtime.get(options),...patch});runtime.flush();},dispose:()=>{lifecycle.destroy();dispose();}};
}
test('For You clears prior viewers immediately and cannot retain them after failed replacement or late delivery',async()=>{
 client.setDelivery(async()=>content());const {source,dispose}=fixture();
 try{
  await source.load();let finish!:(value:ReturnType<typeof content>)=>void,signal!:AbortSignal;
  client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
  const stale=source.load(),oldSignal=signal;
  client.setDelivery(async()=>{throw new Error('Temporary');});
  page.data.user={id:'next-viewer'};runtime.flush();expect(oldSignal.aborted).toBe(true);expect(source.items).toEqual([]);
  await settle();expect(source.error).toBe('Temporary');expect(source.items).toEqual([]);
  finish(content('stale-viewer'));await stale;expect(source.items).toEqual([]);
 }finally{dispose();}
});
test('withdrawn medium, reading subtype and Planning clear content without requesting disabled sources and resume when enabled',async()=>{
 for(const feature of ['music','book','planning']){
  let requests=0;client.setDelivery(async()=>{requests++;return content();});
  const {source,dispose}=fixture(feature==='book'?{feature:'row',category:'reading',kind:'book',genre:'Fiction'}:feature==='planning'?{feature:'upcoming'}:{});
  try{
   await source.load();expect(requests).toBe(1);
   if(feature==='music')page.data.experimentalMusic=false;else if(feature==='book')page.data.experimentalBooks=false;else page.data.experiments.planning=false;
   await settle();expect(source.items).toEqual([]);expect(requests).toBe(1);
   if(feature==='music')page.data.experimentalMusic=true;else if(feature==='book')page.data.experimentalBooks=true;else page.data.experiments.planning=true;
   await settle();expect(requests).toBe(2);expect(source.items).toHaveLength(1);
  }finally{dispose();}
 }
});
test('For You keeps ordinary revisions lazy, ignores equivalent context and preserves settled content on transient refresh errors',async()=>{
 let requests=0;client.setDelivery(async()=>{requests++;return content();});const {source,dispose}=fixture();
 try{
  page.data.contentRevision.tracking='two';page.data.user={id:'viewer'};await settle();expect(requests).toBe(0);expect(source.ready).toBe(false);
  await source.load();expect(requests).toBe(1);page.data.user={id:'viewer'};await settle();expect(requests).toBe(1);
  client.setDelivery(async()=>{throw new Error('Temporary');});page.data.contentRevision.tracking='three';await settle();expect(source.items[0].id).toBe('old');
  client.setDelivery(async()=>{throw new client.ApiError('Private',403);});await source.load();expect(source.items).toEqual([]);expect(source.error).toBe('Private');
 }finally{dispose();}
});
test('changed fixed row category refreshes its own current selection',async()=>{
 const paths:string[]=[];client.setDelivery(async(path:string)=>{paths.push(path);return content(path);});const {source,update,dispose}=fixture();
 try{await source.load();update({category:'game'});await settle();expect(paths).toHaveLength(2);expect(new URL(paths[1],'http://fixture/').searchParams.get('category')).toBe('game');}finally{dispose();}
});
