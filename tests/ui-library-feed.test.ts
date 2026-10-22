import {expect,test} from 'bun:test';
// @ts-expect-error The rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,resourceUrl} from './fixtures/ui-script';
const routeUrl=moduleUrl(compileRunes(`export const page=$state({url:new URL('http://fixture/for-you'),data:{user:{id:'owner',role:'admin'},capabilities:{screen:true,requests:true,music:true,game:true,book:true,comic:true},experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,contentRevision:{tracking:'one'}}});`));
const lifecycleUrl=moduleUrl(`export {untrack} from '${import.meta.resolve('svelte/internal/client')}';const hooks=[];export const onDestroy=fn=>hooks.push(fn);export const destroy=()=>hooks.splice(0).forEach(fn=>fn());`);
const clientUrl=moduleUrl(`export class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}export let deliver;export const set=fn=>deliver=fn;export const useClient=()=>({preview:true,api:(...args)=>deliver(...args)});export const goto=()=>{};export const useShelfLocation=()=>({url:new URL('http://fixture/for-you'),embedded:true});`);
const client=await import(clientUrl),lifecycle=await import(lifecycleUrl),route=await import(routeUrl);
const code=compileRunes((await Bun.file(new URL('../src/lib/ui/shelves/library-feed.svelte.ts',import.meta.url)).text())
 .replaceAll('#lib/ui/client.js',clientUrl).replaceAll('$app/state',routeUrl).replaceAll('$app/navigation',clientUrl).replaceAll('#lib/ui/client-context.js',clientUrl).replaceAll('#lib/ui/detail-section.svelte.js',clientUrl)
 .replaceAll('#lib/ui/resource.svelte.js',resourceUrl).replaceAll('#lib/library.js',import.meta.resolve('../src/lib/library')).replaceAll('#lib/library-feed.js',import.meta.resolve('../src/lib/library-feed'))
 .replaceAll('#lib/ui/content-revision.svelte.js',moduleUrl('export const contentRevisionKey=data=>data.contentRevision.tracking;')).replaceAll("from 'svelte'",`from '${lifecycleUrl}'`));
const {createLibraryFeedSource}:typeof import('../src/lib/ui/shelves/library-feed.svelte')=await import(moduleUrl(code));
const settle=async()=>{for(let i=0;i<8;i++){runtime.flush();await Promise.resolve();}};
const result=(ids:string[],page=1)=>({items:ids.map(id=>({id,kind:'book',title:id})),page,pages:3,total:45});
test('library feeds stay lazy, cancel replaced selections and deduplicate incremental batches',async()=>{
 const calls:{url:URL;signal:AbortSignal;resolve:(data:ReturnType<typeof result>)=>void}[]=[];
 client.set((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'http://fixture/'),signal:options.signal,resolve})));
 let source!:ReturnType<typeof createLibraryFeedSource>;
 const dispose=runtime.effect_root(()=>source=createLibraryFeedSource(()=>({type:'library-feed',feature:'recent'})));await settle();
 try{
  expect(calls).toHaveLength(0);
  const initial=source.load();expect(calls[0].url.searchParams.get('preview')).toBe('true');
  source.controls.find(control=>control.label==='Media type')!.change('book');expect(calls[0].signal.aborted).toBe(true);
  calls[0].resolve(result(['stale']));calls[1].resolve(result(['first','second']));await initial;await settle();
  expect(source.items.map(item=>item.id)).toEqual(['first','second']);
  const append=source.load(2,true);await source.load(2,true);expect(calls).toHaveLength(3);
  calls[2].resolve(result(['second','third'],2));await append;await settle();
  expect(source.items.map(item=>item.id)).toEqual(['first','second','third']);
  const pending=source.load(3,true);lifecycle.destroy();dispose();expect(calls[3].signal.aborted).toBe(true);
  calls[3].resolve(result(['late'],3));await pending;await settle();expect(source.items.map(item=>item.id)).not.toContain('late');
 }finally{lifecycle.destroy();dispose();}
});
test('requests keep state/type filters server-side and withdraw stale owner or disabled content',async()=>{
 route.page.data.user.id='owner';route.page.data.capabilities.requests=true;
 const calls:{url:URL;signal:AbortSignal;resolve:(data:ReturnType<typeof result>)=>void}[]=[];
 client.set((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'http://fixture/'),signal:options.signal,resolve})));
 let source!:ReturnType<typeof createLibraryFeedSource>;
 const dispose=runtime.effect_root(()=>source=createLibraryFeedSource(()=>({type:'library-feed',feature:'requests',layout:'grid'})));await settle();
 try{
  expect(source.filters[0].value).toBe('available');expect(source.filters[0].options?.map(option=>option.value)).toEqual(['available','pending','approved','declined']);
  const first=source.load();calls[0].resolve(result(['old-owner']));await first;await settle();
  expect(source.enrichSocial).toBe(false);expect(source.pagination).toMatchObject({infinite:true,controls:'none'});
  source.filters[0].change('approved');source.controls[0].change('show');expect(calls[1].signal.aborted).toBe(true);
  expect(calls[2].url.searchParams.get('state')).toBe('approved');expect(calls[2].url.searchParams.get('kind')).toBe('show');
  route.page.data.user.id='new-owner';await settle();expect(calls[2].signal.aborted).toBe(true);expect(source.items).toEqual([]);
  calls[1].resolve(result(['stale']));calls[2].resolve(result(['stale']));calls[3].resolve(result(['new-owner']));await settle();
  expect(source.items.map(item=>item.id)).toEqual(['new-owner']);
  route.page.data.user.role='user';await settle();expect(source.items).toEqual([]);
  expect(calls).toHaveLength(5);calls[4].resolve(result(['own-only']));await settle();expect(source.items.map(item=>item.id)).toEqual(['own-only']);
  route.page.data.capabilities.requests=false;await settle();expect(source.items).toEqual([]);
  await source.load();expect(calls).toHaveLength(5);
 }finally{lifecycle.destroy();dispose();route.page.data.capabilities.requests=true;}
});
test('feed scope and replacement cards publish atomically without revealing prior-filter cards',async()=>{
 const calls:{resolve:(data:ReturnType<typeof result>)=>void}[]=[];
 client.set(()=>new Promise(resolve=>calls.push({resolve})));
 let source!:ReturnType<typeof createLibraryFeedSource>;
 const dispose=runtime.effect_root(()=>source=createLibraryFeedSource(()=>({type:'library-feed',feature:'recent'})));await settle();
 try{
  const first=source.load();calls[0].resolve(result(['old-filter']));await first;await settle();
  expect(source.items.map(item=>item.id)).toEqual(['old-filter']);
  source.controls.find(control=>control.label==='Media type')!.change('book');expect(source.items).toEqual([]);
  calls[1].resolve(result(['new-filter']));
  for(let turn=0;turn<12;turn++){await Promise.resolve();runtime.flush();expect(source.items.map(item=>item.id)).not.toContain('old-filter');}
  expect(source.items.map(item=>item.id)).toEqual(['new-filter']);
 }finally{lifecycle.destroy();dispose();}
});

test('current feed permission denial clears retained cards while transient and stale failures cannot withdraw fresh content',async()=>{
 const calls:{resolve:(data:ReturnType<typeof result>)=>void;reject:(cause:Error)=>void}[]=[];
 client.set(()=>new Promise((resolve,reject)=>calls.push({resolve,reject})));
 let source!:ReturnType<typeof createLibraryFeedSource>;
 const dispose=runtime.effect_root(()=>source=createLibraryFeedSource(()=>({type:'library-feed',feature:'requests'})));await settle();
 try{
  expect(new URL(source.href!,'http://fixture').searchParams.get('view')).toBe('watch');
  const first=source.load();calls[0].resolve(result(['private']));await first;
  const transient=source.load();calls[1].reject(new client.ApiError('Temporary',502));await transient;
  expect(source.items.map(item=>item.id)).toEqual(['private']);
  const stale=source.load();source.filters[0].change('approved');calls[3].resolve(result(['fresh']));await settle();
  calls[2].reject(new client.ApiError('Old scope denied',403));await stale;
  expect(source.items.map(item=>item.id)).toEqual(['fresh']);expect(source.error).toBe('');
  const denied=source.load();calls[4].reject(new client.ApiError('Access withdrawn',403));await denied;
  expect(source.items).toEqual([]);expect(source.error).toBe('Access withdrawn');
 }finally{lifecycle.destroy();dispose();}
});

test('combined Recently added has no subtype segments and cancels another action before publication',async()=>{
 const calls:{path:string;signal:AbortSignal;resolve:(data:ReturnType<typeof result>)=>void}[]=[];
 client.set((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({path,signal:options.signal,resolve})));
 const action=runtime.state('watch');let source!:ReturnType<typeof createLibraryFeedSource>;
 const dispose=runtime.effect_root(()=>source=createLibraryFeedSource(()=>({type:'library-feed',feature:'recent',action:runtime.get(action) as 'watch'|'read'})));await settle();
 try{
  expect(source.filters).toEqual([]);
  const stale=source.load();
  expect(new URL(calls[0].path,'http://fixture/').searchParams.get('kind')).toBe('all');
  runtime.set(action,'read');await settle();
  expect(calls[0].signal.aborted).toBe(true);
  expect(new URL(calls[1].path,'http://fixture/').searchParams.get('action')).toBe('read');
  calls[1].resolve(result(['reading']));await settle();
  calls[0].resolve(result(['stale-watching']));await stale;
  expect(source.items.map(item=>item.id)).toEqual(['reading']);
 }finally{lifecycle.destroy();dispose();}
});
