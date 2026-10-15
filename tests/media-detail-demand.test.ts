import { expect, test } from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import { compileRunes, componentScript, moduleUrl, resourceUrl, svelteUrl } from './fixtures/ui-script';

const routeUrl=moduleUrl(compileRunes(`export const page=$state({data:{user:{id:'viewer'}},url:new URL('http://test/media/title')});`));
const {page}=await import(routeUrl);
const castUrl=moduleUrl(compileRunes((await Bun.file(new URL('../src/lib/ui/shelves/cast.svelte.ts',import.meta.url)).text())
  .replaceAll('$app/state',routeUrl).replaceAll("from 'svelte'",`from ${JSON.stringify(svelteUrl)}`)));
let script=await componentScript('src/lib/ui/components/MediaDetailRows.svelte');
const propsStart=script.indexOf('let {'),propsEnd=script.indexOf('} = $props();',propsStart);
script=script.slice(0,propsStart)+'let {item,members=[],seasons=[],cast=[],section}=$derived(getOptions());'+script.slice(propsEnd+'} = $props();'.length);
const code=compileRunes(`import {untrack} from ${JSON.stringify(svelteUrl)};
 import {createResource,uniqueItems} from ${JSON.stringify(resourceUrl)};
 import {createCastSelection} from ${JSON.stringify(castUrl)};
 import {page} from ${JSON.stringify(routeUrl)};
 export function create(getOptions,transport){
 const callbacks=[],useClient=()=>({api:transport}),onDestroy=fn=>callbacks.push(fn);
 ${script}
 return {activate(row){if(row==='insights')insightsActive=true;else if(row==='reviews')reviewsActive=true;else creditsActive=true;},
 select(value){selection=value;},community(value){communitySource=value;},reviews(value){reviewSource=value;},
 get data(){return data;},get credits(){return credits;},get busy(){return busy;},load,
 cleanup(){callbacks.forEach(fn=>fn());}};
 }`);
const {create}=await import(moduleUrl(code));
const settle=async()=>{for(let i=0;i<8;i++){runtime.flush();await Promise.resolve();}};
const content=(source:string,page=1)=>({source,page,pages:2,reviews:[{id:source+'-'+page}],crew:[{id:1,name:'Crew',character:'Director'}],facts:[]});
function fixture(section?:string,parameters:Record<string,string>={}){
 page.data.user={id:'viewer'};page.url=new URL('http://test/media/title?'+new URLSearchParams(parameters));
 const options=runtime.state({item:{id:'title-a'},section,cast:[{id:2,name:'Cast',character:'Actor'}]});
 const requests:{path:string;signal:AbortSignal;finish:(value:unknown)=>void;fail:(error:Error)=>void}[]=[];
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=create(()=>runtime.get(options),(path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>new Promise((finish,fail)=>requests.push({path,signal,finish,fail}))));
 runtime.flush();
 return {controller,requests,replace(id:string){runtime.set(options,{...runtime.get(options),item:{id}});runtime.flush();},close(){controller.cleanup();dispose();}};
}

test('dedicated media sections fetch only demanded sources, retaining TMDB crew and no duplicate shared loads',async()=>{
 const selections:{section:string;params:Record<string,string>;row:string;sources:string[]}[]=[
  {section:'credits',params:{},row:'credits',sources:['tmdb']},
  {section:'insights',params:{insight:'activity'},row:'insights',sources:[]},
  {section:'insights',params:{insight:'overview'},row:'insights',sources:['tmdb']},
  {section:'insights',params:{insight:'community',source:'trakt'},row:'insights',sources:['trakt']},
  {section:'reviews',params:{source:'tmdb'},row:'reviews',sources:['tmdb']},
 ];
 for(const selection of selections){
  const f=fixture(selection.section,selection.params);
  try{
   expect(f.requests).toHaveLength(0);
   f.controller.activate(selection.row);await settle();
   expect(f.requests.map(request=>new URL(request.path,'http://test').searchParams.get('source'))).toEqual(selection.sources);
   f.requests.forEach(request=>request.finish(content('tmdb')));await settle();
   f.controller.activate(selection.row);await settle();expect(f.requests).toHaveLength(selection.sources.length);
   if(selection.row==='credits'){
    f.controller.credits.selection='crew';await settle();expect(f.controller.credits.people.map((person:any)=>person.name)).toEqual(['Crew']);
   }
  }finally{f.close();}
 }
});

test('overview rows activate independently and share cached source results; changing selection cancels unused pending work',async()=>{
 const f=fixture();
 try{
  f.controller.activate('insights');await settle();expect(f.requests).toHaveLength(1);expect(f.requests[0].path).toContain('source=tmdb');
  f.controller.activate('credits');await settle();expect(f.requests).toHaveLength(1);
  f.requests[0].finish(content('tmdb'));await settle();
  f.controller.activate('reviews');await settle();expect(f.requests).toHaveLength(2);expect(f.requests[1].path).toContain('source=trakt');
  f.controller.reviews('tmdb');await settle();expect(f.requests[1].signal.aborted).toBe(true);
  f.requests[1].finish(content('obsolete-trakt'));await settle();expect(f.controller.data.trakt).toBeNull();
  f.controller.reviews('all');await settle();expect(f.requests).toHaveLength(3);
  f.requests[2].finish(content('trakt'));await settle();
  f.controller.select('activity');f.controller.reviews('tmdb');await settle();
  f.controller.reviews('all');await settle();expect(f.requests).toHaveLength(3);
 }finally{f.close();}
});

test('item/viewer replacement and destruction abort stale detail requests, retain lazy rows and preserve retry/append',async()=>{
 const f=fixture('reviews',{source:'tmdb'});
 try{
  f.replace('never-activated');await settle();expect(f.requests).toHaveLength(0);
  f.controller.activate('reviews');await settle();expect(f.requests).toHaveLength(1);
  f.replace('replacement');await settle();expect(f.requests[0].signal.aborted).toBe(true);expect(f.requests).toHaveLength(2);
  f.requests[0].finish(content('stale'));await settle();expect(f.controller.data.tmdb).toBeNull();
  f.requests[1].fail(new Error('Temporary'));await settle();expect(f.requests).toHaveLength(2);
  const retry=f.controller.load('tmdb');expect(f.requests).toHaveLength(3);f.requests[2].finish(content('tmdb'));await retry;await settle();
  const append=f.controller.load('tmdb',2);f.requests[3].finish(content('tmdb',2));await append;await settle();
  expect(f.controller.data.tmdb.reviews.map((review:any)=>review.id)).toEqual(['tmdb-1','tmdb-2']);
  page.data.user={id:'new-viewer'};await settle();expect(f.requests).toHaveLength(5);expect(f.controller.data.tmdb).toBeNull();
  const current=f.requests[4];f.close();expect(current.signal.aborted).toBe(true);
  current.finish(content('after-destruction'));await settle();expect(f.controller.data.tmdb).toBeNull();
  await f.controller.load('tmdb');expect(f.requests).toHaveLength(5);
 }finally{f.close();}
});
