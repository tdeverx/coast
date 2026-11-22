import {expect,test} from 'bun:test';
import {compileRunes,componentScript,moduleUrl,resourceUrl} from './fixtures/ui-script';
// @ts-expect-error The Svelte test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';

const script=(await componentScript('src/lib/profile/TasteMatch.svelte')).replace('$props()','properties');
const {dialog}=await import(moduleUrl(compileRunes(`
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function dialog(properties,transport){
  const useClient=()=>({api:transport});
  let mount,dispose;
  const onMount=callback=>mount=callback,onDestroy=callback=>dispose=callback;
  ${script}
  return {mount,dispose,show,close,get rating(){return personalRating;}};
 }
`)));

test('the personal detail button waits for selection; the admin result issues one scoped, cancellable read',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 for(const admin of [false,true]){
  const reads:{path:string;method:string;signal:AbortSignal}[]=[];
  let closed=false;
  const result=dialog({workId:id,group:'collection',adminTitle:admin?'A box set':undefined,onclose:()=>{closed=true;}},
   (path:string,_body:unknown,method:string,options:{signal:AbortSignal})=>{
    reads.push({path,method,signal:options.signal});
    return new Promise(()=>{});
   });
  try{
   expect(reads).toHaveLength(0);
   result.mount();
   if(!admin){expect(reads).toHaveLength(0);result.show();}
   expect(reads).toHaveLength(1);
   expect(reads[0].method).toBe('GET');
   expect(reads[0].path).toBe(`${admin?'admin/taste-score':'profile/taste-match'}?workId=${id}&group=collection`);
   expect(reads[0].signal.aborted).toBe(false);
   result.close();
   expect(closed).toBe(true);
   expect(reads[0].signal.aborted).toBe(true);
  }finally{result.dispose();}
 }
});

test('the dialog uses the existing title rating separately from a collection comparison',()=>{
 const workId='00000000-0000-4000-8000-000000000001',transport=()=>Promise.resolve({match:null});
 const title=dialog({workId,rating:2.5},transport),group=dialog({workId,rating:2.5,group:'collection'},transport);
 try{
  expect(title.rating).toBe(2.5);
  expect(group.rating).toBeNull();
 }finally{title.dispose();group.dispose();}
});

const personalScript=(await componentScript('src/lib/profile/PersonalTaste.svelte')).replace('$props()','properties');
const {personal}=await import(moduleUrl(compileRunes(`
 import {createResource} from ${JSON.stringify(resourceUrl)};
 import {tasteMedia,tasteDimensions} from ${JSON.stringify(import.meta.resolve('../src/lib/social/taste-profile'))};
 export function personal(transport){
  const properties={data:[]},useClient=()=>({api:transport}),displayLabel=value=>value;
  const page=$state({data:{capabilities:{screen:true,book:true}}});
  let dispose;const onDestroy=callback=>dispose=callback;
  ${personalScript}
  return {browse,closeBrowser,dispose,disableScreen(){page.data.capabilities.screen=false;},get open(){return open;},
   get items(){return browser.data.items;}};
 }
`)));

test('closing the signal browser or disabling its medium discards an outstanding personal affinity page',async()=>{
 const reads:{path:string;signal:AbortSignal;finish:(value:unknown)=>void}[]=[];
 let view:ReturnType<typeof personal>;
 const release=runtime.effect_root(()=>{
  view=personal((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>
   new Promise(resolve=>reads.push({path,signal,finish:resolve})));
 });
 try{
  runtime.flush();
  expect(reads).toHaveLength(0);
  view.browse('genres');runtime.flush();
  expect(reads[0].path).toContain('medium=movie');
  view.closeBrowser();expect(reads[0].signal.aborted).toBe(true);
  view.browse('cast');runtime.flush();
  view.disableScreen();runtime.flush();
  expect(view.open).toBe(false);
  expect(reads[1].signal.aborted).toBe(true);
  for(const read of reads)read.finish({items:[{name:'stale'}],pages:1});
  await Promise.resolve();
  expect(view.items).toEqual([]);
  expect(reads).toHaveLength(2);
 }finally{view.dispose();release();}
});
