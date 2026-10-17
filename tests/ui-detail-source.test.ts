import { expect, test } from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import { compileRunes, moduleUrl, resourceUrl, svelteUrl } from './fixtures/ui-script';
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(svelteUrl)};export const callbacks=[];export const onDestroy=fn=>callbacks.push(fn);`);
const lifecycle=await import(lifecycleUrl);
const routeUrl=moduleUrl(compileRunes(`export const page=$state({data:{user:{id:'viewer'},revision:0}});`));
const {page}=await import(routeUrl);
const source=(await Bun.file(new URL('../src/lib/ui/shelves/detail.svelte.ts',import.meta.url)).text())
 .replace("from 'svelte'",`from ${JSON.stringify(lifecycleUrl)}`)
 .replace("from '$app/state'",`from ${JSON.stringify(routeUrl)}`)
 .replace("import {useClient} from '$lib/ui/client-context';",'const useClient=()=>({api:transport});')
 .replace("from '$lib/ui/resource.svelte'",`from ${JSON.stringify(resourceUrl)}`)
 .replace("import {contentRevisionKey} from '$lib/ui/content-revision.svelte';",'const contentRevisionKey=data=>data.revision;');
// Each owner receives its transport at construction through the ordinary client boundary.
const module=await import(moduleUrl(compileRunes(`let transport;export const setTransport=value=>transport=value;${source}`)));
const settle=async()=>{for(let i=0;i<8;i++){runtime.flush();await Promise.resolve();}};
const content=(number:number,items:string[],focusId='next')=>({items:items.map(id=>({id,kind:'episode',title:id})),page:number,pages:6,total:360,focusId});
function fixture(anchor=true){
 page.data.user.id='viewer';page.data.revision=0;
 const requests:{path:string;signal:AbortSignal;finish:(value:unknown)=>void}[]=[];
 module.setTransport((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>new Promise(finish=>requests.push({path,signal,finish})));
 let row:any;
 const options=runtime.state({type:'detail',title:'Next',path:'media/show/next',href:'/media/show?section=next',anchor,availability:true,items:undefined});
 const dispose=runtime.effect_root(()=>row=module.createDetailSource(()=>runtime.get(options)));
 runtime.flush();
 return {row,requests,local(items:any){runtime.set(options,{...runtime.get(options),items});},close(){lifecycle.callbacks.splice(0).forEach((fn:()=>void)=>fn());dispose();}};
}
test('anchored rows make no inactive requests and start at the server-selected page',async()=>{
 const f=fixture();try{
  expect(f.requests).toHaveLength(0);expect(f.row.ready).toBe(false);
  f.row.filters[0].change('available');await settle();expect(f.requests).toHaveLength(0);expect(f.row.ready).toBe(false);
  const loading=f.row.load();expect(f.requests[0].path).toBe('media/show/next?available=true');
  f.requests[0].finish(content(4,['next','later']));await loading;await settle();
  expect(f.row.initialItemId).toBe('next');expect(f.row.pagination).toMatchObject({page:4,firstPage:4,pages:6});
  expect(f.row.href).toBe('/media/show?section=next&available=true');
 }finally{f.close();}
});
test('backward and forward pages preserve complete ordered membership and the original focus',async()=>{
 const f=fixture();try{
  const initial=f.row.load();f.requests[0].finish(content(4,['next','later']));await initial;
  const previous=f.row.loadPrevious();expect(f.requests[1].path).toBe('media/show/next?page=3&available=false');
  f.requests[1].finish(content(3,['earlier','next']));await previous;
  expect(f.row.items.map((item:any)=>item.id)).toEqual(['earlier','next','later']);
  expect(f.row.pagination).toMatchObject({firstPage:3,page:4});
  const next=f.row.load(5,true);f.requests[2].finish(content(5,['later','last'],'changed-server-focus'));await next;
  expect(f.row.items.map((item:any)=>item.id)).toEqual(['earlier','next','later','last']);
  expect(f.row.initialItemId).toBe('next');expect(f.row.pagination).toMatchObject({firstPage:3,page:5});
 }finally{f.close();}
});
test('availability and tracking refresh cancel obsolete reads, re-anchor once, and dispose safely',async()=>{
 const f=fixture();try{
  const stale=f.row.load();f.row.filters[0].change('available');await settle();
  expect(f.requests[0].signal.aborted).toBe(true);expect(f.requests).toHaveLength(2);
  f.requests[0].finish(content(1,['stale']));await stale;
  f.requests[1].finish(content(5,['next']));await settle();expect(f.row.items[0].id).toBe('next');
  const key=f.row.resetKey;page.data.revision++;await settle();expect(f.requests).toHaveLength(3);expect(f.row.resetKey).not.toBe(key);
  expect(f.requests[2].path).toBe('media/show/next?available=true');
  f.close();expect(f.requests[2].signal.aborted).toBe(true);
  f.requests[2].finish(content(6,['late']));await settle();expect(f.row.items).toEqual([]);
  await f.row.load();expect(f.requests).toHaveLength(3);
 }finally{f.close();}
});
test('ordinary detail grids retain page-one loading without an initial scroll target',async()=>{
 const f=fixture(false);try{
  const loading=f.row.load();expect(f.requests[0].path).toBe('media/show/next?page=1&available=false');
  f.requests[0].finish(content(1,['first']));await loading;
  expect(f.row.initialItemId).toBeUndefined();expect(f.row.items[0].id).toBe('first');
 }finally{f.close();}
});

test('segments retain the same source and cached episode page while local seasons filter without requests',async()=>{
 const f=fixture();try{
  const initial=f.row.load();f.requests[0].finish(content(4,['next','later']));await initial;
  f.local([{id:'season-1',kind:'season',title:'Season 1',available:true},{id:'season-2',kind:'season',title:'Season 2',available:false}]);await settle();
  expect(f.row.pagination.kind).toBe('local');expect(f.row.items).toHaveLength(2);expect(f.requests).toHaveLength(1);
  f.local(undefined);await settle();expect(f.requests).toHaveLength(1);expect(f.row.items[0].id).toBe('next');
  f.local([{id:'season-1',available:true},{id:'season-2',available:false}]);await settle();
  f.row.filters[0].change('available');await settle();expect(f.requests).toHaveLength(1);expect(f.row.items.map((item:any)=>item.id)).toEqual(['season-1']);
  f.local(undefined);await settle();expect(f.requests).toHaveLength(2);expect(f.requests[1].path).toBe('media/show/next?available=true');
  f.requests[1].finish(content(1,['available-next']));await settle();expect(f.row.items[0].id).toBe('available-next');
 }finally{f.close();}
});
