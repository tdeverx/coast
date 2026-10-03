import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type {ProgressContent} from '../src/lib/progress';
import type {MediaView} from '../src/lib/ui/types';
import type {ProgressSourceOptions} from '../src/lib/ui/shelves/progress.svelte';

const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile=async(path:string)=>compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(new URL(path,import.meta.url)).text()),{filename:'fixture.svelte.js',generate:'client'}).js.code
 .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));
const resourceUrl=moduleUrl(await compile('../src/lib/ui/resource.svelte.ts'));
const revisionUrl=moduleUrl(await compile('../src/lib/ui/content-revision.svelte.ts'));
const clientUrl=moduleUrl(`
 export let delivery=async()=>{throw new Error('Fixture delivery missing');};
 export const setDelivery=next=>{delivery=next;};
 export const useClient=()=>({api:(...args)=>delivery(...args)});
 export class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
`);
const client=await import(clientUrl);
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))}; export const onDestroy=()=>{};`);
const navigationUrl=moduleUrl('export const replaceState=()=>{};');
const routeUrl=moduleUrl('export const page={data:{user:{id:"viewer"},contentRevision:{tracking:"one",social:"one"},experimentalMusic:false,experimentalGaming:false},state:{}};');
const code=(await compile('../src/lib/ui/shelves/progress.svelte.ts'))
 .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll('$lib/experimental',import.meta.resolve('../src/lib/experimental'))
 .replaceAll('$lib/progress',import.meta.resolve('../src/lib/progress'))
 .replaceAll('$lib/ui/client-context',clientUrl)
 .replaceAll('$lib/ui/client',clientUrl)
 .replaceAll('$lib/ui/resource.svelte',resourceUrl)
 .replaceAll('$lib/ui/content-revision.svelte',revisionUrl)
 .replaceAll('$app/navigation',navigationUrl).replaceAll('$app/state',routeUrl);
const {createProgressSource}:typeof import('../src/lib/ui/shelves/progress.svelte')=await import(moduleUrl(code));
const item={id:'work',title:'Visible profile card',kind:'movie'} as MediaView;
const content:ProgressContent={view:'watching',kind:'all',category:'screen',scope:'all',page:1,pages:1,total:1,items:[item]};

function source(username?:string){
 let result!:ReturnType<typeof createProgressSource>;
 const configuration=runtime.state({initial:content,username,surface:username?'profile':'continue'} as ProgressSourceOptions);
 const dispose=runtime.effect_root(()=>{result=createProgressSource(()=>runtime.get(configuration));});
 runtime.flush();
 return {result,dispose,replaceOwner:(username:string,initial:ProgressContent)=>{runtime.set(configuration,{initial,username,surface:'profile'});runtime.flush();}};
}
test('private/unavailable profiles clear settled cards while transient and own-shelf failures retain them',async()=>{
 for(const status of [403,404,500]){
  const {result,dispose}=source('owner');
  try{
   client.setDelivery(async()=>{throw new client.ApiError('Profile unavailable',status);});
   await result.load();
   expect(result.items).toEqual(status===500?[item]:[]);expect(result.error).toBe('Profile unavailable');
  }finally{dispose();}
 }
 const {result,dispose}=source();
 try{
  client.setDelivery(async()=>{throw new client.ApiError('Not found',404);});await result.load();
  expect(result.items).toEqual([item]);
 }finally{dispose();}
});
test('superseded profile failures cannot clear a replacement result',async()=>{
 const {result,dispose}=source('owner');
 let reject!:(cause:Error)=>void;
 try{
  client.setDelivery(()=>new Promise((_done,fail)=>{reject=fail;}));
  const old=result.load();
  const replacement={...content,items:[{...item,id:'replacement'}]};
  client.setDelivery(async()=>replacement);await result.load();
  reject(new client.ApiError('Stale private response',404));await old;
  expect(result.items).toEqual(replacement.items);expect(result.error).toBe('');
 }finally{dispose();}
});
test('a private response for the previous owner cannot clear the newly mounted profile',async()=>{
 const {result,dispose,replaceOwner}=source('previous-owner');
 let reject!:(cause:Error)=>void;
 try{
  client.setDelivery(()=>new Promise((_done,fail)=>{reject=fail;}));
  const old=result.load();
  const replacement={...content,items:[{...item,id:'replacement-owner-work'}]};
  replaceOwner('replacement-owner',replacement);
  expect(result.items).toEqual(replacement.items);
  reject(new client.ApiError('Previous owner is private',403));await old;
  expect(result.items).toEqual(replacement.items);expect(result.error).toBe('');
 }finally{dispose();}
});
