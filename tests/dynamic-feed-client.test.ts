import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type {DynamicRow} from '../src/lib/recommendations/model';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
function compile(source:string){return compileModule(new Bun.Transpiler({loader:'ts',deadCodeElimination:false,treeShaking:false}).transformSync(source),{filename:'feed.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));}
const resourceUrl=moduleUrl(compile(await Bun.file(new URL('../src/lib/ui/resource.svelte.ts',import.meta.url)).text()));
const routeUrl=moduleUrl(compile('export const page=$state({data:{user:{id:"viewer"},contentRevision:{tracking:"one",social:"one"},experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true}});'));
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};const hooks=[];export const onDestroy=callback=>hooks.push(callback);export const destroy=()=>hooks.splice(0).forEach(callback=>callback());`);
const clientUrl=moduleUrl('export let delivery;export const setDelivery=next=>delivery=next;export const useClient=()=>({api:(...args)=>delivery(...args)});');
const {page}=await import(routeUrl),client=await import(clientUrl),lifecycle=await import(lifecycleUrl);
// Compile the actual component script; only browser/context boundaries are
// injected. The bottom observer still owns calling load in the rendered app.
const source=(await Bun.file(new URL('../src/lib/recommendations/DynamicFeed.svelte',import.meta.url)).text()).split('<script lang="ts">')[1].split('</script>')[0].replace(/^\s*import .*?;\s*$/gm,'');
const imports=`import {onDestroy,untrack} from ${JSON.stringify(lifecycleUrl)};import {page} from ${JSON.stringify(routeUrl)};import {useClient} from ${JSON.stringify(clientUrl)};import {createResource} from ${JSON.stringify(resourceUrl)};`;
const {createFeed}=await import(moduleUrl(compile(`${imports}export function createFeed(){${source};return {load,settled,get data(){return {rows};},get complete(){return complete;},get pending(){return pendingKey;},get seed(){return seed;}};}`)));
type Feed={load:()=>Promise<void>;settled:(key:string)=>void;data:{rows:DynamicRow[]};complete:boolean;pending:string|undefined;seed:string};
const settle=async()=>{for(let index=0;index<6;index++){runtime.flush();await Promise.resolve();}};
function fixture(){
 page.data.user={id:'viewer'};page.data.contentRevision={tracking:'one',social:'one'};page.data.experimentalMusic=true;page.data.experimentalGaming=true;page.data.experimentalBooks=true;page.data.experimentalComics=true;
 let feed!:Feed;const dispose=runtime.effect_root(()=>feed=createFeed());runtime.flush();
 return {feed,dispose:()=>{lifecycle.destroy();dispose();}};
}
const row=(index:number):DynamicRow=>({key:`row-${index}`,category:'screen',surface:'recommendations',title:`Row ${index}`});
test('one immutable census reveals one row per settlement and content edits cannot skip or replay definitions',async()=>{
 const paths:string[]=[];let definitions=Array.from({length:62},(_,index)=>row(index));
 client.setDelivery(async(path:string)=>{paths.push(path);return {rows:definitions};});
 const {feed,dispose}=fixture();
 try{
  expect(paths).toEqual([]);
  for(let index=0;index<30;index++){
   await feed.load();expect(feed.pending).toBe(`row-${index}`);expect(feed.data.rows).toHaveLength(index+1);
   await feed.load();expect(feed.data.rows).toHaveLength(index+1);feed.settled(`row-${index}`);
  }
  expect(paths).toHaveLength(1);expect(new URL(paths[0],'http://fixture/').searchParams.has('offset')).toBe(false);
  const seed=feed.seed;
  definitions=[row(999),...definitions.filter(item=>item.key!=='row-0')].reverse();
  page.data.contentRevision={tracking:'two',social:'two'};page.data.user={id:'viewer'};await settle();
  expect(paths).toHaveLength(1);expect(feed.seed).toBe(seed);expect(feed.data.rows).toHaveLength(30);
  for(let index=30;index<62;index++){await feed.load();expect(feed.pending).toBe(`row-${index}`);feed.settled(`row-${index}`);}
  expect(feed.data.rows.map(item=>item.key)).toEqual(Array.from({length:62},(_,index)=>`row-${index}`));
  expect(feed.complete).toBe(true);await feed.load();expect(paths).toHaveLength(1);
 }finally{dispose();}
});
test('scope changes clear withdrawn rows, cancel late census publication and start a fresh lazy visit',async()=>{
 let finish!:(value:{rows:DynamicRow[]})=>void,signal!:AbortSignal;
 client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
 const {feed,dispose}=fixture();
 try{
  const loading=feed.load(),oldSignal=signal;
  page.data.user={id:'next-viewer'};await settle();
  expect(oldSignal.aborted).toBe(true);expect(feed.data.rows).toEqual([]);expect(feed.complete).toBe(false);
  finish({rows:[row(99)]});await loading;expect(feed.data.rows).toEqual([]);
  client.setDelivery(async()=>({rows:[row(0),row(1)]}));await feed.load();expect(feed.data.rows).toHaveLength(1);
  page.data.experimentalComics=false;await settle();expect(feed.data.rows).toEqual([]);expect(feed.pending).toBeUndefined();expect(feed.complete).toBe(false);
  client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
  const unmounted=feed.load(),unmountedSignal=signal;dispose();expect(unmountedSignal.aborted).toBe(true);finish({rows:[row(3)]});await unmounted;expect(feed.data.rows).toEqual([]);
 }finally{dispose();}
});
test('failed census retries and an empty or completed visit stays settled after content revisions',async()=>{
 let requests=0;client.setDelivery(async()=>{if(++requests===1)throw new Error('Temporary');return {rows:[]};});
 const {feed,dispose}=fixture();
 try{await feed.load();expect(feed.complete).toBe(false);await feed.load();expect(feed.complete).toBe(true);page.data.contentRevision.tracking='finished';await settle();await feed.load();expect(requests).toBe(2);}
 finally{dispose();}
});
