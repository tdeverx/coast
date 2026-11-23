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

test('details wait for selection and both score explanations issue one scoped, cancellable read',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 for(const origin of ['detail','card','admin'] as const){
  const reads:{path:string;method:string;signal:AbortSignal}[]=[];
  let closed=false;
  const result=dialog({workId:id,group:origin==='card'?undefined:'collection',
   inspect:origin==='detail'?undefined:{title:'An item',admin:origin==='admin'},onclose:()=>{closed=true;}},
   (path:string,_body:unknown,method:string,options:{signal:AbortSignal})=>{
    reads.push({path,method,signal:options.signal});
    return new Promise(()=>{});
   });
  try{
   expect(reads).toHaveLength(0);
   result.mount();
   if(origin==='detail'){expect(reads).toHaveLength(0);result.show();}
   expect(reads).toHaveLength(1);
   expect(reads[0].method).toBe('GET');
   expect(reads[0].path).toBe(`${origin==='admin'?'admin/taste-score':'profile/taste-match'}?workId=${id}&${origin==='card'?'breakdown=true':'group=collection'}`);
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

const personalScript=(await componentScript('src/lib/profile/TasteSignals.svelte')).replace('$props()','properties');
const {personal}=await import(moduleUrl(compileRunes(`
 import {createResource} from ${JSON.stringify(resourceUrl)};
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 export function personal(transport){
  const properties=$state({medium:'movie'}),useClient=()=>({api:transport});
  const page=$state({data:{contentRevision:{tracking:'first'}}});
  let dispose;const onDestroy=cb=>dispose=cb;
  ${personalScript}
  return {refresh(){page.data.contentRevision.tracking='next';},dispose};
 }
`)));
test('the personal signal view cancels superseded and closed reads',async()=>{
 const reads:{path:string;signal:AbortSignal;finish:(value:unknown)=>void}[]=[];
 let view:ReturnType<typeof personal>;
 const release=runtime.effect_root(()=>{
  view=personal((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>
   new Promise(resolve=>reads.push({path,signal,finish:resolve})));
 });
 try{
  runtime.flush();
  expect(reads).toHaveLength(1);expect(reads[0].path).toContain('taste-signals?medium=movie');
  view.refresh();runtime.flush();expect(reads[0].signal.aborted).toBe(true);
  expect(reads).toHaveLength(2);view.dispose();expect(reads[1].signal.aborted).toBe(true);
  for(const read of reads)read.finish(null);
  await Promise.resolve();
 }finally{release();}
});
