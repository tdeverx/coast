// Actual-data caller supplies every response. Only scheduling/failure/withdrawal is authored.
// This fixture never creates catalogue rows, identities, provider responses or credentials.
import {isDeepStrictEqual as same} from 'node:util';
import {compileRunes,moduleUrl} from './ui-script';
import type {LibraryContent} from '../../src/lib/library';
// @ts-expect-error Svelte's internal rune control runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
const read=(path:string)=>Bun.file(new URL('../../'+path,import.meta.url)).text();
const plain=(text:string)=>new Bun.Transpiler({loader:'ts'}).transformSync(text);
const pure=async(path:string)=>moduleUrl(plain(await read(path)));
const resource=moduleUrl(compileRunes(await read('src/lib/ui/resource.svelte.ts')));
const revision=moduleUrl(compileRunes(await read('src/lib/ui/content-revision.svelte.ts')));
const paths=await pure('src/lib/library.ts'),windows=await pure('src/lib/page-window.ts'),features=await pure('src/lib/experimental.ts'),filters=await pure('src/lib/ui/filter-options.ts');
const client=await read('src/lib/ui/client.ts'),start=client.indexOf('export class ApiError');
if(start<0)throw Error('actual_api_error_source_required');
const errors=moduleUrl(plain(client.slice(start,client.indexOf('/**',start))));
const {ApiError}=await import(errors);
const complete=await read('src/lib/ui/shelves/library.svelte.ts'),owner=complete.slice(complete.indexOf('export function createLibrarySource(')).replace('export function createLibrarySource','function createLibrarySource');
const fixture=compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte'))};
 import {createResource as nativeResource} from ${JSON.stringify(resource)};
 import {contentRevisionKey} from ${JSON.stringify(revision)};
 import {ApiError} from ${JSON.stringify(errors)};
 import {libraryBrowsePaths,libraryTitles,librarySelections} from ${JSON.stringify(paths)};
 import {createPageRetention,retainPageWindow,retainedInterval} from ${JSON.stringify(windows)};
 import {surfaceEnabled,categoryEnabled} from ${JSON.stringify(features)};
 import {readingTypeOptions} from ${JSON.stringify(filters)};
 export function create(transport,data,input={}){
  let route=$state.raw({data,state:{}}),options=$state.raw({surface:'watch',layout:'grid',...input.options});
  const cleanups=[],resources=[],navigation=[];
  const createResource=(...args)=>{const r=nativeResource(...args);resources.push(r);return r;};
  const useShelfLocation=()=>({embedded:input.embedded??true}),useClient=()=>({api:transport,preview:false});
  const replaceState=(href,state)=>{if(input.embedded!==false)throw Error('embedded_must_not_rewrite_route');navigation.push({href,state});},onDestroy=fn=>cleanups.push(fn);
  ${owner}
  const source=createLibrarySource(()=>options);
  return {source,navigation,setOptions(value){options=value;},setData(value){route={...route,data:value};},get content(){if(resources.length!==1)throw Error('one_resource_required');return resources[0].data;},dispose(){for(const fn of cleanups.splice(0))fn();}};
 }
`);
const {create}=await import(moduleUrl(fixture));
const settle=async()=>{for(let i=0;i<18;i++){runtime.flush();await Promise.resolve();}};
const assert=(value:unknown,code:string)=>{if(!value)throw Error(code);};

type ActualReader=(path:string)=>Promise<LibraryContent>;
/** Run only inside the verified read-only actual-data frame; no output contains row payloads. */
export async function actualLibraryWindowControls(data:Record<string,unknown>,readActual:ActualReader) {
 const results:{label:string;requests:number;actualRowsOnly:true}[]=[];
 function environment(input:Record<string,unknown>={}){
  const calls:any[]=[];let controller:any;
  const dispose=runtime.effect_root(()=>controller=create((path:string,_body:unknown,_method:string,{signal}:{signal:AbortSignal})=>
   new Promise((resolve,reject)=>calls.push({path,url:new URL(path,'http://coast/'),signal,resolve,reject})),data,input));
  runtime.flush();
  return {controller,calls,async answer(index:number){assert(!!calls[index],'required_actual_request');const value=await readActual(calls[index].path);calls[index].resolve(value);await settle();return value;},
   finish(){controller.dispose();dispose();for(const call of calls)call.reject(Error('disposed_control'));}};
 }
 async function accumulate(env:ReturnType<typeof environment>,last=3){
  for(let number=1;number<=last;number++){const pending=env.controller.source.load(number,number>1);await env.answer(env.calls.length-1);await pending;}
 }
 const record=(label:string,env:ReturnType<typeof environment>)=>results.push({label,requests:env.calls.length,actualRowsOnly:true});
 const key=(item:any)=>item.entryId??('href'in item?item.href:item.id);
 {
  const env=environment();try{
   await accumulate(env,4);const retained=env.controller.source.items;
   assert(retained.length>0&&env.controller.source.pagination.firstPage===2,'actual_three_page_positive_window');
   env.controller.setData({...data,contentRevision:{tracking:'authored-later-revision'}});await settle();
   const request=env.calls[4];assert(request.url.searchParams.get('firstPage')==='2'&&request.url.searchParams.get('page')==='4','one_retained_range_refresh');
   assert(same(retained,env.controller.source.items),'range_retained_before_answer');
   request.reject(new ApiError('Authored read failure',502));await settle();
   assert(same(retained,env.controller.source.items)&&!!env.controller.source.error,'retryable_failure_retains_complete_actual_window');
   const retry=env.controller.source.retry();assert(env.calls.length===6,'one_range_retry');
   assert(env.calls[5].url.searchParams.get('firstPage')==='2','retry_keeps_native_first_page');
   const actual=await env.answer(5);await retry;
   assert(same(actual.items,env.controller.source.items)&&env.controller.source.pagination.firstPage===2,'complete_range_atomic_publication');
   record('actual-range-refresh-failure-retry',env);
  }finally{env.finish();}
 }
 {
  const env=environment();try{
   await accumulate(env);const retained=env.controller.source.items,held=key(retained[0]);
   const releaseMenu=env.controller.source.retain(held),releaseWrite=env.controller.source.retain(held);
   const append=env.controller.source.load(4,true);await env.answer(3);await append;
   assert(same(retained,env.controller.source.items)&&!!env.controller.source.error,'actual_card_lease_blocks_eviction');
   releaseMenu();await settle();assert(env.calls.length===4,'partial_release_has_no_refetch');
   releaseWrite();await settle();assert(env.calls.length===5,'all_evicted_owners_release_one_retry');
   await env.controller.source.retry();assert(env.calls.length===5&&!env.calls[4].signal.aborted,'toast_retry_cannot_cancel_owned_retry');
   await env.answer(4);assert(env.controller.source.pagination.firstPage===2&&env.controller.source.items.length===retained.length,'released_card_allows_bounded_next_window');
   const retry=env.controller.source.retry();assert(env.calls.length===6&&env.calls[5].url.searchParams.get('firstPage')==='2','same_scope_retry_preserves_window');await env.answer(5);await retry;
   record('actual-card-independent-owner-backpressure',env);
  }finally{env.finish();}
 }
 {
  const env=environment();try{
   await accumulate(env);const old=env.controller.source.load(4,true),held=env.calls[3];
   const oldActual=await readActual(held.path);
   env.controller.source.filters.find((control:any)=>control.type==='segments').change('watched');
   assert(held.signal.aborted&&env.controller.source.items.length===0,'selection_change_cancels_and_clears');
   held.resolve(oldActual);await old;await settle();assert(env.controller.source.items.length===0,'late_actual_old_page_cannot_publish');
   const fresh=await env.answer(4);assert(same(fresh.items,env.controller.source.items),'new_actual_selection_complete');
   const pending=env.controller.source.retry(),denied=env.calls[5];denied.reject(new ApiError('Authored current denial',403));await pending;await settle();
   assert(env.controller.source.items.length===0&&!!env.controller.source.error,'current_denial_clears_private_window');
   record('actual-filter-fence-and-current-denial',env);
  }finally{env.finish();}
 }
 {
  const env=environment();try{
   await accumulate(env);const oldLease=env.controller.source.retain(key(env.controller.source.items[0]));
   const pending=env.controller.source.load(4,true),held=env.calls[3],oldActual=await readActual(held.path);
   env.controller.setData({...data,user:null});await settle();assert(held.signal.aborted&&env.controller.source.items.length===0,'viewer_withdrawal_clears_and_cancels');
   held.resolve(oldActual);await pending;await settle();await env.controller.source.load();assert(env.calls.length===4&&env.controller.source.items.length===0,'withdrawn_viewer_has_no_late_publication_or_new_read');
   env.controller.setData(data);await settle();await env.answer(4);
   for(let number=2;number<=4;number++){const next=env.controller.source.load(number,true);await env.answer(env.calls.length-1);await next;}
   assert(env.controller.source.pagination.firstPage===2&&!env.controller.source.error,'retired_old_scope_lease_cannot_block_reauthenticated_window');
   const count=env.calls.length;oldLease();await settle();assert(env.calls.length===count,'old_scope_release_cannot_start_new_scope_reads');
   record('actual-viewer-withdrawal-and-retired-owner',env);
  }finally{env.finish();}
 }
 {
  const env=environment();try{
   await accumulate(env);const pending=env.controller.source.load(4,true),held=env.calls[3],oldActual=await readActual(held.path),retained=env.controller.source.items;
   env.controller.dispose();held.resolve(oldActual);await pending;await settle();await env.controller.source.load();
   assert(held.signal.aborted&&same(retained,env.controller.source.items)&&env.calls.length===4,'disposed_owner_cannot_publish_or_start_reads');
   record('actual-disposal-fence',env);
  }finally{env.finish();}
 }
 {
  const initial=await readActual('library?surface=watch&selection=all&scope=available&page=1');
  const env=environment({embedded:false,options:{initial}});try{
   await settle();const held=env.controller.source.retain(key(initial.items[0]));
   const nextInitial=await readActual('library?surface=watch&selection=all&scope=available&page=1');
   env.controller.setOptions({surface:'watch',layout:'grid',initial:nextInitial});await settle();
   assert(env.calls.length===0&&same(initial.items,env.controller.source.items),'fresh_actual_ssr_projection_reused_without_read');
   for(let number=2;number<=4;number++){const next=env.controller.source.load(number,true);await env.answer(env.calls.length-1);await next;}
   assert(env.calls.length===3&&env.controller.source.pagination.firstPage===1&&!!env.controller.source.error,'same_scope_ssr_update_preserves_existing_card_lease');
   held();await settle();assert(env.calls.length===4,'released_ssr_owner_allows_one_retry');await env.answer(3);
   assert(env.controller.source.pagination.firstPage===2,'ssr_window_advances_after_owner_release');
   record('actual-ssr-reuse-preserves-engagement',env);
  }finally{env.finish();}
 }
 return {schedules:results,boundary:'Actual canonical DTOs from the verified clone reader; failures, revision/filter/viewer/disposal order and retained-owner releases are authored controls. This is not browser/HTTP/native SQL cancellation or positive normal-data mutation evidence.'};
}
