import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import type {ProgressExperimentContent} from '../src/lib/progress-experiment';
import type {ProgressExperimentSourceOptions} from '../src/lib/ui/shelves/progress-experiment.svelte';

const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile=async(path:string)=>compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(new URL(path,import.meta.url)).text()),{filename:'fixture.svelte.js',generate:'client'}).js.code
  .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'));
const resourceUrl=moduleUrl(await compile('../src/lib/ui/resource.svelte.ts'));
const revisionUrl=moduleUrl(await compile('../src/lib/ui/content-revision.svelte.ts'));
const clientUrl=moduleUrl(`
  export class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
  export let delivery=async()=>{throw Error('Missing delivery');};
  export const setDelivery=next=>delivery=next;
  export const useClient=()=>({api:(...args)=>delivery(...args),preview:false});
`);
const lifecycleUrl=moduleUrl(`
  export {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))};
  let cleanup=[];export const onDestroy=fn=>cleanup.push(fn);
  export const dispose=()=>{for(const fn of cleanup.splice(0))fn();};
`);
const routeUrl=moduleUrl(`
  import {state,get,set} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
  const data=state({});export const replace=next=>set(data,next);
  export const page={get data(){return get(data);},state:{}};
`);
const navigationUrl=moduleUrl('export const goto=async()=>{};');
const code=(await compile('../src/lib/ui/shelves/progress-experiment.svelte.ts'))
  .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`)
  .replaceAll('$app/state',routeUrl).replaceAll('$app/navigation',navigationUrl)
  .replaceAll('#lib/progress-experiment.js',import.meta.resolve('../src/lib/progress-experiment'))
  .replaceAll('#lib/ui/client-context.js',clientUrl)
  .replaceAll('#lib/ui/client.js',clientUrl)
  .replaceAll('#lib/ui/detail-section.svelte.js',moduleUrl('export const useShelfLocation=()=>({embedded:true});'))
  .replaceAll('#lib/ui/resource.svelte.js',resourceUrl)
  .replaceAll('#lib/ui/content-revision.svelte.js',revisionUrl)
  .replaceAll('#lib/experimental.js',import.meta.resolve('../src/lib/experimental'))
  .replaceAll('#lib/ui/filter-options.js',import.meta.resolve('../src/lib/ui/filter-options'));
const {createProgressExperimentSource}:typeof import('../src/lib/ui/shelves/progress-experiment.svelte')=await import(moduleUrl(code));
const client=await import(clientUrl),route=await import(routeUrl),lifecycle=await import(lifecycleUrl);
const content=(id='original',view:ProgressExperimentContent['view']='continue'):ProgressExperimentContent=>({
  view,kind:'all',scope:'all',page:1,pages:1,total:1,items:[{id,title:id,kind:'movie'} as ProgressExperimentContent['items'][number]],
});
const data=(revision='one')=>({user:{id:'viewer'},contentRevision:{tracking:revision,social:'one'},experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true});
function source(options:Omit<ProgressExperimentSourceOptions,'type'>={}){
  route.replace(data());
  const configuration=runtime.state({type:'progress-experiment',...options} as ProgressExperimentSourceOptions);
  let result!:ReturnType<typeof createProgressExperimentSource>;
  const stop=runtime.effect_root(()=>{result=createProgressExperimentSource(()=>runtime.get(configuration));});
  runtime.flush();
  return {result,replace:(next:ProgressExperimentSourceOptions)=>runtime.set(configuration,next),dispose:()=>{stop();lifecycle.dispose();}};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();runtime.flush();};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};}

test('Progress is lazy, requests only a row preview, and does not refetch unchanged selections or session polls',async()=>{
  const calls:string[]=[];
  client.setDelivery(async(path:string)=>{calls.push(path);return content();});
  const {result,dispose}=source();
  try{
    expect(calls).toHaveLength(0);
    await result.load();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('preview=true');
    result.filters[0].change('continue');result.filters[1].change('all');result.controls[0].change('all');
    route.replace({...data(),capabilities:{screen:true}});runtime.flush();await settle();
    // A policy change is meaningful; an identical session snapshot after it is not.
    expect(calls).toHaveLength(2);
    route.replace({...data(),capabilities:{screen:true}});runtime.flush();await settle();
    expect(calls).toHaveLength(2);
    result.filters[0].change('continue');result.controls[0].change('all');await settle();
    expect(calls).toHaveLength(2);
  }finally{dispose();}
});

test('an authoritative SSR replacement and its content revision cause no duplicate client request',async()=>{
  let calls=0;
  client.setDelivery(async()=>{calls++;return content('unexpected');});
  const {result,replace,dispose}=source({layout:'grid',initial:content()});
  try{
    replace({type:'progress-experiment',layout:'grid',initial:content('server replacement')});
    route.replace(data('two'));runtime.flush();await settle();
    expect(calls).toBe(0);expect(result.items[0].id).toBe('server replacement');
    route.replace(data('three'));runtime.flush();await settle();
    expect(calls).toBe(1);
  }finally{dispose();}
});

test('superseded segment reads retain cards, fence late data, remember filters, and abort on disposal',async()=>{
  const pending:ReturnType<typeof deferred<ProgressExperimentContent>>[]=[],signals:AbortSignal[]=[],paths:string[]=[];
  client.setDelivery((path:string,_body:unknown,_method:unknown,{signal}:{signal:AbortSignal})=>{
    const next=deferred<ProgressExperimentContent>();pending.push(next);signals.push(signal);paths.push(path);return next.promise;
  });
  const {result,dispose}=source({initial:content()});
  try{
    result.controls[0].change('movie');
    result.filters[0].change('next');
    expect(signals[0].aborted).toBe(true);expect(result.items[0].id).toBe('original');expect(result.busy).toBe(true);
    pending[1].resolve(content('next result','next'));await settle();
    pending[0].resolve(content('stale result'));await settle();
    expect(result.items[0].id).toBe('next result');
    result.filters[0].change('continue');
    expect(paths[2]).toContain('kind=movie');
    dispose();expect(signals[2].aborted).toBe(true);
    pending[2].resolve(content('after disposal'));await settle();
    await result.load();expect(paths).toHaveLength(3);expect(result.items[0].id).toBe('next result');
  }finally{dispose();}
});

test('expanded requests keep full pages and never inherit preview mode',async()=>{
  let path='';client.setDelivery(async(next:string)=>{path=next;return content();});
  const {result,dispose}=source({layout:'grid'});
  try{await result.load(2);expect(path).toContain('page=2');expect(path).not.toContain('preview');}
  finally{dispose();}
});

test('profile Progress adds Finished/Dropped and preserves the owner in row reads and expanded links',async()=>{
  const paths:string[]=[];client.setDelivery(async(path:string)=>{paths.push(path);return content();});
  const {result,dispose}=source({username:'profile owner'});
  try{
    expect(result.filters[0].options?.map(option=>option.value)).toEqual(['continue','next','finished','dropped']);
    const continueKey=result.resetKey;
    result.filters[0].change('finished');await settle();
    expect(result.resetKey).not.toBe(continueKey);
    const finishedKey=result.resetKey;await result.load(2,true);expect(result.resetKey).toBe(finishedKey);
    const url=new URL(paths[0],'http://fixture/');expect(url.searchParams.get('username')).toBe('profile owner');expect(url.searchParams.get('view')).toBe('finished');
    expect(new URL(result.href!,'http://fixture').searchParams.get('username')).toBe('profile owner');
    result.filters[0].change('dropped');await settle();expect(new URL(paths[2],'http://fixture').searchParams.get('view')).toBe('dropped');
  }finally{dispose();}
});

test('private profile failures clear cards while transient failures preserve the current selection',async()=>{
  for(const status of [403,404,500]){
    client.setDelivery(async()=>{throw new client.ApiError('Unavailable',status);});
    const {result,dispose}=source({username:'owner',initial:content()});
    try{await result.load();expect(result.items.map(item=>item.id)).toEqual(status===500?['original']:[]);expect(result.error).toBe('Unavailable');}
    finally{dispose();}
  }
});

test('replacing the profile owner cancels outgoing data and fences late private errors',async()=>{
  let reject!:(cause:Error)=>void,oldSignal!:AbortSignal;
  client.setDelivery((_path:unknown,_body:unknown,_method:unknown,{signal}:{signal:AbortSignal})=>{oldSignal=signal;return new Promise((_resolve,no)=>reject=no);});
  const {result,replace,dispose}=source({username:'previous',initial:content()});
  try{
    const outgoing=result.load();client.setDelivery(async()=>content('replacement'));
    replace({type:'progress-experiment',username:'replacement'});runtime.flush();await settle();
    expect(oldSignal.aborted).toBe(true);expect(result.items.map(item=>item.id)).toEqual(['replacement']);
    reject(new client.ApiError('Previous profile private',403));await outgoing;
    expect(result.items.map(item=>item.id)).toEqual(['replacement']);expect(result.error).toBe('');
  }finally{dispose();}
});

test('Progress hides music from cards and filters and labels its saved selection Later',()=>{
  const initial=content();initial.items.push({id:'music-track',kind:'track',title:'Track',href:'/music/work/track'},{id:'music-album',kind:'album',title:'Album',href:'/music/work/album'});
  const {result,dispose}=source({initial});
  try{
    expect(result.items.map(item=>item.id)).toEqual(['original']);
    expect(result.controls[0].options?.map(option=>option.value)).not.toContain('album');
    expect(result.controls[0].options?.map(option=>option.value)).not.toContain('track');
    expect(result.filters[0].options?.find(option=>option.value==='watchlist')?.label).toBe('Later');
  }finally{dispose();}
});
