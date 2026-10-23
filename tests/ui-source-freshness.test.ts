import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type {LibrarySourceOptions} from '../src/lib/ui/shelves/library.svelte';
import type {LibraryContent} from '../src/lib/library';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile=async(path:string)=>compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(new URL(path,import.meta.url)).text()),{filename:'fixture.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));
const resourceUrl=moduleUrl(await compile('../src/lib/ui/resource.svelte.ts'));
const revisionUrl=moduleUrl(await compile('../src/lib/ui/content-revision.svelte.ts'));
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))};export const onDestroy=()=>{};`);
const routeUrl=moduleUrl(compileModule('export const navigating={to:null};export const page=$state({data:{user:{id:"viewer"},contentRevision:{tracking:"one",social:"one"},filters:{kind:"all"}},state:{},url:new URL("http://test/library")});',{filename:'route.svelte.js',generate:'client'}).js.code.replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client')));
const clientUrl=moduleUrl(`export let delivery;export const setDelivery=next=>delivery=next;export const useClient=()=>({api:(...args)=>delivery(...args)});export class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}`);
const client=await import(clientUrl),{page}=await import(routeUrl),{invalidateContentRevision}=await import(revisionUrl);
const navigationUrl=moduleUrl('export const goto=async()=>{};');
async function adapter(path:string){return import(moduleUrl((await compile(path))
 .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll('#lib/ui/detail-section.svelte.js',moduleUrl(`import {page} from '${routeUrl}';export const useShelfLocation=()=>({embedded:false,get url(){return page.url;}});`))
 .replaceAll('$app/state',routeUrl).replaceAll('$app/navigation',navigationUrl)
 .replaceAll('#lib/ui/client-context.js',clientUrl).replaceAll('#lib/ui/client.js',clientUrl)
 .replaceAll('#lib/ui/resource.svelte.js',resourceUrl).replaceAll('#lib/ui/content-revision.svelte.js',revisionUrl)
 .replaceAll('#lib/library.js',import.meta.resolve('../src/lib/library'))
 .replaceAll('#lib/ui/filter-options.js',import.meta.resolve('../src/lib/ui/filter-options'))));}
const {createLibrarySource}:typeof import('../src/lib/ui/shelves/library.svelte')=await adapter('../src/lib/ui/shelves/library.svelte.ts');
const {createCreditsSource}:typeof import('../src/lib/ui/shelves/credits.svelte')=await adapter('../src/lib/ui/shelves/credits.svelte.ts');
const content=(id='work',available=true):LibraryContent=>({items:[{id,kind:'movie',title:id,available,progress:0,duration:0,watched:false,playCount:0,watchlist:false,favourite:false,collected:false,dropped:false,rating:null}],page:1,pages:1,total:1});
const settle=async()=>{for(let i=0;i<10;i++){runtime.flush();await Promise.resolve();}};
function reset(){page.data.user={id:'viewer'};page.data.contentRevision={tracking:'one',social:'one'};page.data.filters={kind:'all'};}
function library(initial?:LibraryContent,extra:Partial<LibrarySourceOptions>={}){
 reset();if(extra.surface==='listen')page.data.experimentalMusic=true;
 const options=runtime.state({surface:'watch',layout:initial?'grid':'row',initial,...extra} as LibrarySourceOptions);
 let result!:ReturnType<typeof createLibrarySource>;
 const dispose=runtime.effect_root(()=>result=createLibrarySource(()=>runtime.get(options)));
 runtime.flush();
 return {result,dispose,update:(patch:Partial<LibrarySourceOptions>)=>{runtime.set(options,{...runtime.get(options),...patch});runtime.flush();}};
}
test('Library refreshes activated rows for relevant revisions, retains lazy rows and ignores equivalent filters/session data',async()=>{
 let requests=0;client.setDelivery(async()=>{requests++;return content('work-'+requests);});
 const {result,dispose}=library();
 try{
  page.data.contentRevision.tracking='two';page.data.user={id:'next-viewer'};await settle();expect(requests).toBe(0);expect(result.ready).toBe(false);
  await result.load();expect(requests).toBe(1);
  page.data.user={id:'next-viewer'};page.data.filters={kind:'all'};await settle();expect(requests).toBe(1);
  page.data.contentRevision.tracking='three';await settle();expect(requests).toBe(2);
  invalidateContentRevision(['tracking']);await settle();expect(requests).toBe(3);
  result.controls[0].change('show');await settle();expect(requests).toBe(4);
  page.data.contentRevision.social='two';await settle();expect(requests).toBe(5);
  expect(result.controls[0].value).toBe('show');
 }finally{dispose();}
});
test('Library retains settled cards on transient refresh failure but clears denied or previous-viewer delivery',async()=>{
 client.setDelivery(async()=>content());const {result,dispose}=library();
 let finish!:(value:LibraryContent)=>void,signal!:AbortSignal;
 try{
  await result.load();
  client.setDelivery(async()=>{throw new client.ApiError('Temporary',500);});await result.load();
  expect(result.items[0].id).toBe('work');expect(result.error).toBe('Temporary');
  client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
  const stale=result.load();const staleSignal=signal,staleFinish=finish;
  client.setDelivery(async()=>content('replacement'));
  page.data.user={id:'replacement-viewer'};runtime.flush();
  expect(staleSignal.aborted).toBe(true);expect(result.items).toEqual([]);
  await settle();staleFinish(content('private-old-viewer'));await stale;
  expect(result.items[0].id).toBe('replacement');
  client.setDelivery(async()=>{throw new client.ApiError('Private',403);});await result.load();
  expect(result.items).toEqual([]);expect(result.error).toBe('Private');
 }finally{dispose();}
});
test('Library changed SSR payload replaces data once while equivalent wrappers do not refetch',async()=>{
 let requests=0;client.setDelivery(async()=>{requests++;return content('unexpected');});
 const initial=content('initial'),{result,dispose,update}=library(initial);
 try{
  update({initial:{...initial}});await settle();expect(requests).toBe(0);
  const fresh=content('fresh');page.data.contentRevision.tracking='two';update({initial:fresh});await settle();
  expect(requests).toBe(0);expect(result.items[0].id).toBe('fresh');
  client.setDelivery(async()=>{throw new Error('Temporary');});await result.load();
  expect(result.items[0].id).toBe('fresh');
 }finally{dispose();}
});
test('Credits caches selection returns but retries/revisions fetch fresh results and cancel prior viewer work',async()=>{
 reset();let requests=0;client.setDelivery(async()=>{requests++;return content('work-'+requests);});
 let result!:ReturnType<typeof createCreditsSource>;const dispose=runtime.effect_root(()=>result=createCreditsSource(()=>({personId:1,title:'Credits'})));runtime.flush();
 try{
  page.data.contentRevision.tracking='two';page.data.user={id:'next-viewer'};await settle();expect(requests).toBe(0);expect(result.ready).toBe(false);
  await result.load();expect(requests).toBe(1);
  result.controls[0].change('movie');await settle();expect(requests).toBe(2);
  result.controls[0].change('all');await settle();expect(requests).toBe(2);
  await result.load();expect(requests).toBe(3);
  page.data.contentRevision.tracking='three';await settle();expect(requests).toBe(4);
  expect(result.items[0].id).toBe('work-4');
  let finish!:(value:LibraryContent)=>void,signal!:AbortSignal;
  client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});
  const stale=result.load();const staleFinish=finish,staleSignal=signal;
  client.setDelivery(async()=>content('new-viewer'));
  page.data.user={id:'new-viewer'};runtime.flush();expect(staleSignal.aborted).toBe(true);expect(result.items).toEqual([]);
  await settle();staleFinish(content('stale'));await stale;expect(result.items[0].id).toBe('new-viewer');
 }finally{dispose();}
});
test('Library sorting and segment changes cancel pending pages and restart one clean native window',async()=>{
 const calls:{url:URL;signal:AbortSignal;resolve:(value:LibraryContent)=>void}[]=[];
 client.setDelivery((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'http://test/'),signal:options.signal,resolve})));
 const {result,dispose,update}=library();update({layout:'grid',segments:true,kindControl:false});
 try{
  const first=result.load();calls[0].resolve({...content('first'),pages:5,total:300});await first;
  const append=result.load(2,true);
  result.controls.find(control=>control.label==='Sort by')!.change('added');
  expect(calls[1].signal.aborted).toBe(true);expect(result.items).toEqual([]);
  expect(calls[2].url.searchParams.get('sort')).toBe('added');expect(calls[2].url.searchParams.get('page')).toBe('1');
  result.filters[0].change('next');expect(calls[2].signal.aborted).toBe(true);
  expect(calls[3].url.searchParams.get('segment')).toBe('next');expect(calls[3].url.searchParams.get('sort')).toBe('added');
  calls[1].resolve({...content('late-page'),page:2,pages:5,total:300});calls[2].resolve(content('late-sort'));calls[3].resolve(content('current'));
  await append;await settle();expect(result.items.map(item=>item.id)).toEqual(['current']);
  expect(result.pagination).toMatchObject({page:1,firstPage:1,infinite:true,automatic:false,controls:'none'});
  expect(calls).toHaveLength(4);
 }finally{dispose();}
});

test('Library entity changes publish matching totals and cancel stale pages while preserving manual loading',async()=>{
 const calls:{url:URL;signal:AbortSignal;resolve:(value:LibraryContent)=>void}[]=[];
 client.setDelivery((path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>calls.push({url:new URL(path,'http://test/'),signal:options.signal,resolve})));
 const initial={...content('first'),total:500,pages:9};
 const {result,dispose}=library(initial,{entitySegments:true,countHeading:true,initialKind:'movie'});
 try{
  expect(result.title).toBe('500 movies');
  const pending=result.load(2,true);
  result.filters[0].change('show');await settle();
  expect(calls[0].signal.aborted).toBe(true);
  expect(result.title).toBe('… shows');
  calls[1].resolve({...content('sorted'),total:700,pages:12});await settle();
  calls[0].resolve({...content('stale'),total:999,pages:17});await pending;
  expect(result.items.map(item=>item.id)).toEqual(['sorted']);
  expect(result.title).toBe('700 shows');
  expect(result.pagination.kind==='pages'&&result.pagination.automatic).toBe(false);
 }finally{dispose();}
});

test('home music uses native Library pages and entity tabs without progress states or preview limits',async()=>{
 const paths:URL[]=[];client.setDelivery(async(path:string)=>{const url=new URL(path,'http://fixture');paths.push(url);return {...content('music-'+paths.length),page:Number(url.searchParams.get('page')??1),pages:3,total:125};});
 const {result,dispose}=library(undefined,{surface:'listen',title:'Music library',entitySegments:true,initialSelection:'album',initialScope:'all',kindControl:false});
 try{
  page.data.experimentalMusic=true;runtime.flush();
  expect(result.activated).toBe(false);expect(paths).toHaveLength(0);
  await result.load();expect(paths[0].searchParams.has('preview')).toBe(false);expect(result.title).toBe('Music library');
  expect(result.filters[0].options?.map(option=>option.value)).toEqual(['album','artist','track','playlist']);
  expect(result.controls.find(control=>control.label==='Status')?.options?.map(option=>option.value)).toEqual(['all','later','favourites']);
  await result.load(2,true);expect(paths[1].searchParams.get('page')).toBe('2');expect(result.items).toHaveLength(2);
  result.filters[0].change('artist');await settle();
  expect(result.controls.some(control=>control.label==='Status')).toBe(false);
  expect(new URL(result.href!,'http://fixture').searchParams.get('kind')).toBe('artist');
  expect(result.pagination).toMatchObject({kind:'pages',append:true,automatic:true,page:1});
 }finally{dispose();page.data.experimentalMusic=false;}
});

test('saved action rows preserve their scope and fence old viewers and filters during replacement',async()=>{
 const {createProgressSource}:typeof import('../src/lib/ui/shelves/progress.svelte')=await adapter('../src/lib/ui/shelves/progress.svelte.ts');
 reset();const payload=(id:string,scope='all')=>({...content(id),view:'watchlist',category:'screen',kind:'all',scope});
 client.setDelivery(async()=>payload('private'));
 let result!:ReturnType<typeof createProgressSource>;const dispose=runtime.effect_root(()=>result=createProgressSource(()=>({surface:'watchlist',category:'screen',actionScoped:true})));runtime.flush();
 const pending:{signal:AbortSignal;finish:(value:ReturnType<typeof payload>)=>void}[]=[];
 try{
  await result.load();expect(new URL(result.href!,'http://fixture').searchParams.get('scoped')).toBe('true');
  expect(result.filters.some(control=>control.type==='segments')).toBe(false);
  client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>new Promise(resolve=>pending.push({signal:options.signal,finish:resolve})));
  result.filters.find(control=>control.type==='availability')!.change('available');expect(result.items).toEqual([]);
  page.data.user={id:'other'};runtime.flush();expect(pending[0].signal.aborted).toBe(true);expect(result.items).toEqual([]);
  pending[1].finish(payload('current','available'));await settle();pending[0].finish(payload('late','available'));await settle();
  expect(result.items.map(item=>item.id)).toEqual(['current']);
 }finally{dispose();}
});

test('unactivated saved rows remain lazy after an account change',async()=>{
 const {createProgressSource}:typeof import('../src/lib/ui/shelves/progress.svelte')=await adapter('../src/lib/ui/shelves/progress.svelte.ts');
 reset();let calls=0;client.setDelivery(async()=>{calls++;return {...content(),view:'watchlist',category:'screen',kind:'all',scope:'all'};});
 let result!:ReturnType<typeof createProgressSource>;const dispose=runtime.effect_root(()=>result=createProgressSource(()=>({surface:'watchlist',category:'screen',actionScoped:true})));runtime.flush();
 try{page.data.user={id:'next-viewer'};await settle();expect(calls).toBe(0);expect(result.ready).toBe(false);await result.load();expect(calls).toBe(1);}
 finally{dispose();}
});
