import {expect,test} from 'bun:test';
// @ts-expect-error Internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl,svelteUrl} from './fixtures/ui-script';
import {requestOptionsUrl} from './fixtures/request-options';
const operationUrl=moduleUrl(compileRunes((await Bun.file(new URL('../src/lib/ui/operation.svelte.ts',import.meta.url)).text()).replace("import { message } from './client';",'const message=error=>error.message;')));
let script=await componentScript('src/lib/ui/components/RequestDialog.svelte');
const from=script.indexOf('let {'),to=script.indexOf('} = $props();',from);
script=script.slice(0,from)+`let item=$state.raw(initial.item??{id:'first',kind:'show'}),seasonNumber=$state(initial.seasonNumber),initial4k=$state(initial.initial4k??false),options=$state.raw(initial.options),onsent,open=$state(true);`+script.slice(to+'} = $props();'.length);
const code=compileRunes(`import {untrack} from ${JSON.stringify(svelteUrl)};import {createRequestOptions} from ${JSON.stringify(requestOptionsUrl)};import {createOperation} from ${JSON.stringify(operationUrl)};
 export function create(transport,initial={}){const callbacks=[],onDestroy=fn=>callbacks.push(fn),useClient=()=>({api:transport,change:()=>{throw Error('No request submission in read lifetime test');}}),reportFailure=()=>{};
 ${script}
 return {retry:load,get destinations(){return destinations;},get destination(){return destination;},get selected(){return selected;},get fourK(){return is4k;},get loaded(){return loaded;},get error(){return failure;},get pending(){return read.busy;},close(){open=false;},reopen(){open=true;},replace(value){item=value;},provide(value){options=value;},cleanup(){callbacks.forEach(fn=>fn());}};}`);
const {create}=await import(moduleUrl(code));
const settle=async()=>{for(let i=0;i<8;i++){runtime.flush();await Promise.resolve();}};
function fixture(initial:any={}){
 const calls:{path:string;signal:AbortSignal;resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>owner=create((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>new Promise((resolve,reject)=>calls.push({path,signal,resolve,reject})),initial));runtime.flush();
 return {owner,calls,close(){owner.cleanup();dispose();}};
}
const destination=(id:string)=>({id,name:id,variants:{standard:{serverId:1,requestable:true,seasons:[{number:2,requested:false,available:false}]},fourK:{serverId:2,requestable:true,seasons:[{number:2,requested:false,available:false}]}}});
test('request dialog aborts pending target/retry/close reads and ignores late old success or error',async()=>{
 const f=fixture({seasonNumber:2});try{
  expect(f.calls).toHaveLength(1);expect(f.calls[0].path).toBe('requests/options?mediaId=first');
  f.owner.replace({id:'second',kind:'show'});await settle();expect(f.calls[0].signal.aborted).toBe(true);expect(f.calls).toHaveLength(2);
  f.calls[0].resolve({destinations:[destination('old')]});await settle();expect(f.owner.destinations).toEqual([]);expect(f.owner.loaded).toBe(false);
  const retry=f.owner.retry();expect(f.calls[1].signal.aborted).toBe(true);expect(f.calls).toHaveLength(3);
  f.calls[1].reject(Error('old error'));await settle();expect(f.owner.error).toBe('');expect(f.owner.pending).toBe(true);
  f.calls[2].resolve({destinations:[destination('current')]});await retry;await settle();expect(f.owner.destination).toBe('current');expect(f.owner.selected).toEqual([2]);
  const pending=f.owner.retry();f.owner.close();await settle();expect(f.calls[3].signal.aborted).toBe(true);expect(f.owner.pending).toBe(false);
  f.calls[3].resolve({destinations:[destination('closed')]});await pending;await settle();expect(f.owner.destinations).toEqual([]);
  f.owner.reopen();await settle();expect(f.calls).toHaveLength(5);f.close();expect(f.calls[4].signal.aborted).toBe(true);
  f.calls[4].resolve({destinations:[destination('disposed')]});await settle();expect(f.owner.destinations).toEqual([]);
 }finally{f.close();}
});
test('preloaded options including empty results need no read and preserve quality/season selection',async()=>{
 const f=fixture({options:[destination('provided')],initial4k:true,seasonNumber:2});try{
  await settle();expect(f.calls).toHaveLength(0);expect(f.owner.loaded).toBe(true);expect(f.owner.destination).toBe('provided');expect(f.owner.fourK).toBe(true);expect(f.owner.selected).toEqual([2]);
  f.owner.provide([]);await settle();expect(f.owner.destinations).toEqual([]);expect(f.owner.loaded).toBe(true);expect(f.calls).toHaveLength(0);
  f.owner.provide(undefined);await settle();expect(f.calls).toHaveLength(1);expect(f.owner.loaded).toBe(false);
 }finally{f.close();}
});
test('independent request-option consumers do not share abort ownership',async()=>{
 const first=fixture(),second=fixture();try{
  first.owner.close();await settle();expect(first.calls[0].signal.aborted).toBe(true);expect(second.calls[0].signal.aborted).toBe(false);
  second.calls[0].resolve({destinations:[destination('interested')]});await settle();expect(second.owner.destination).toBe('interested');
 }finally{first.close();second.close();}
});
