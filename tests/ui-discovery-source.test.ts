import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type { DiscoveryContent } from '../src/lib/discovery';
import type { DiscoveryOptions } from '../src/lib/ui/shelves/discovery.svelte';

const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = async (path: string) => compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(await Bun.file(new URL(path, import.meta.url)).text()), { filename: 'fixture.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
const resourceUrl = moduleUrl(await compile('../src/lib/ui/resource.svelte.ts'));
const revisionUrl = moduleUrl(await compile('../src/lib/ui/content-revision.svelte.ts'));
const clientUrl = moduleUrl('export let delivery; export const setDelivery=next=>delivery=next; export const useClient=()=>({api:(...args)=>delivery(...args)});');
const client = await import(clientUrl);
const lifecycleUrl = moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))}; export const onDestroy=()=>{};`);
const routeUrl = moduleUrl(`export const page={data:{user:{id:'viewer'},contentRevision:{tracking:'one',social:'one'}}};`);
const navigationUrl = moduleUrl('export const replaceState=()=>{}; export const goto=async()=>{};');
const code = (await compile('../src/lib/ui/shelves/discovery.svelte.ts'))
  .replaceAll('from "svelte"', `from ${JSON.stringify(lifecycleUrl)}`)
  .replaceAll('#lib/ui/detail-section.svelte.js',moduleUrl(`import {page} from '${routeUrl}';export const useShelfLocation=()=>({embedded:false,get url(){return page.url;}});`))
 .replaceAll('$app/state', routeUrl).replaceAll('$app/navigation', navigationUrl)
  .replaceAll('#lib/ui/client-context.js', clientUrl).replaceAll('#lib/ui/resource.svelte.js', resourceUrl)
  .replaceAll('#lib/ui/content-revision.svelte.js', revisionUrl)
  .replaceAll('#lib/ui/filter-options.js', import.meta.resolve('../src/lib/ui/filter-options'))
  .replaceAll('#lib/discovery.js', import.meta.resolve('../src/lib/discovery'));
const { createDiscoverySource }: typeof import('../src/lib/ui/shelves/discovery.svelte') = await import(moduleUrl(code));
const { invalidateContentRevision } = await import(revisionUrl);
const watch: DiscoveryContent = { items: [{id:'watch',kind:'movie',title:'Screen',href:'/media/watch',available:true} as any], failure:'' };
const content = (id: string, available=true): DiscoveryContent => ({items:[{id,kind:'album',title:id,href:'/music/'+id,available}],failure:''});
const settle = async () => { for (let i=0;i<8;i++) { runtime.flush(); await Promise.resolve(); } };
function source(initial: DiscoveryContent | null = watch) {
  const options = runtime.state({type:'discovery',section:'trending',surface:'watch',initial:initial ?? undefined,mediums:{experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true}} as DiscoveryOptions);
  let result!: ReturnType<typeof createDiscoverySource>;
  const dispose = runtime.effect_root(()=>{result=createDiscoverySource(()=>runtime.get(options));});
  runtime.flush();
  return { result, dispose, update: (patch: Partial<DiscoveryOptions>) => {runtime.set(options,{...runtime.get(options),...patch});runtime.flush();} };
}
function medium(result: ReturnType<typeof createDiscoverySource>, value: string) { result.filters[0].change(value); }

test('Discover caches unchanged selections but revisions discard every medium and explicit retry fetches fresh content', async () => {
  let requests=0;
  client.setDelivery(async()=>content('music-'+(++requests)));
  const {result,dispose,update}=source();
  try {
    medium(result,'listen'); await settle(); expect(requests).toBe(1);
    medium(result,'watch'); medium(result,'listen'); await settle(); expect(requests).toBe(1);
    update({initial:{...watch}}); await settle(); expect(requests).toBe(1);
    medium(result,'watch');
    invalidateContentRevision(['tracking']); await settle();
    medium(result,'listen'); await settle(); expect(result.items[0].id).toBe('music-3');
    await result.load(); expect(result.items[0].id).toBe('music-4');
    invalidateContentRevision(['social']); await settle(); expect(requests).toBe(5);
  } finally { dispose(); }
});

test('refreshed SSR source data invalidates other cached mediums and old availability cannot return',async()=>{
  let available=true,requests=0;
  client.setDelivery(async()=>{requests++;return content('music',available);});
  const {result,dispose,update}=source();
  try {
    medium(result,'listen'); await settle(); medium(result,'watch');
    available=false; update({initial:{...watch,items:[...watch.items]}}); await settle();
    medium(result,'listen'); await settle(); expect(requests).toBe(2);expect(result.items[0].available).toBe(false);
  } finally { dispose(); }
});

test('withdrawn media clears pending content, resets the selection and rejects late delivery',async()=>{
  for(const selected of ['listen','play','read']) {
    let finish!:(value:DiscoveryContent)=>void,signal!:AbortSignal;
    client.setDelivery((_path: string,_body: unknown,_method: string,options: {signal:AbortSignal})=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});});
    const {result,dispose,update}=source();
    try {
      medium(result,selected); expect(result.busy).toBe(true);
      const stale=finish,oldSignal=signal;
      update({mediums:{experimentalMusic:false,experimentalGaming:false,experimentalBooks:false,experimentalComics:false}});
      expect(oldSignal.aborted).toBe(true); expect(result.filters[0].value).toBe('watch');expect(result.items).toEqual([]);
      stale(content('withdrawn'));await settle();expect(result.items).toEqual([]);
      finish(watch);await settle();expect(result.items).toEqual(watch.items);
      medium(result,selected);await settle();expect(result.filters[0].value).toBe('watch');
    } finally { dispose(); }
  }
});

test('revision changes leave never-activated rows lazy',async()=>{
  let requests=0;client.setDelivery(async()=>{requests++;return watch;});
  const {result,dispose}=source(null);
  try {invalidateContentRevision(['tracking']);await settle();expect(requests).toBe(0);expect(result.ready).toBe(false);}finally{dispose();}
});

test('reading discovery rows append native pages without resetting their scroll scope',async()=>{
 const paths:URL[]=[];
 client.setDelivery(async(path:string)=>{const url=new URL(path,'http://fixture');paths.push(url);const page=Number(url.searchParams.get('page'));return {items:[{id:`book-${page}`,kind:'book',title:`Book ${page}`,href:`/book/${page}`}],failure:'',page,pages:3,total:3};});
 const {result,dispose}=source();
 try{
  medium(result,'read');await settle();const key=result.resetKey;
  expect(result.pagination).toMatchObject({kind:'pages',page:1,pages:3,append:true});
  await result.load(2,true);expect(result.items.map(item=>item.id)).toEqual(['book-1','book-2']);expect(result.resetKey).toBe(key);
  expect(paths[1].searchParams.get('page')).toBe('2');expect(result.pagination).toMatchObject({page:2,pages:3});
  await result.load();expect(paths[2].searchParams.get('page')).toBe('1');expect(result.items).toHaveLength(1);
 }finally{dispose();}
});

test('scoped Discover responds to capability withdrawal without a fallback provider request',async()=>{
 let requests=0,signal!:AbortSignal,finish!:(value:DiscoveryContent)=>void;
 client.setDelivery((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{requests++;signal=options.signal;return new Promise(resolve=>finish=resolve);});
 const {result,dispose,update}=source(null);
 try{
  update({surface:'listen',scoped:true});const pending=result.load();const stale=finish,oldSignal=signal;
  update({mediums:{experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,features:{music:false}}});
  expect(oldSignal.aborted).toBe(true);expect(result.items).toEqual([]);expect(requests).toBe(1);
  stale(content('withdrawn'));await pending;expect(result.items).toEqual([]);
  client.setDelivery(async()=>{requests++;return content('enabled');});
  update({mediums:{experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,features:{music:true}}});await settle();
  expect(requests).toBe(2);expect(result.items[0].id).toBe('enabled');
  expect(result.filters.some(control=>control.type==='availability')).toBe(false);
 }finally{dispose();}
});

test('provider guidance belongs to empty discovery results, not persistent row subtitles',async()=>{
 client.setDelivery(async()=>({...content('album'),notice:'Provider ranking explanation.'}));
 const {result,dispose,update}=source(null);
 try{
  update({surface:'listen',scoped:true});await result.load();
  expect(result.notice).toBeUndefined();expect(result.empty).not.toBe('Provider ranking explanation.');
  client.setDelivery(async()=>({items:[],failure:'',notice:'Connect a provider in Integrations.'}));await result.load();
  expect(result.notice).toBeUndefined();expect(result.empty).toBe('Connect a provider in Integrations.');
 }finally{dispose();}
});
