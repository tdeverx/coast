import {expect,test} from 'bun:test';

// Empty provider results isolate admission/error behavior. Actual membership,
// persistence and presentation are verified separately with the retained corpus.
let generation=0;
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(new Bun.Transpiler({loader:'ts'}).transformSync(source)).toString('base64')}`;
async function owner(){
 const source=await Bun.file(new URL('../src/lib/catalogue/service.server.ts',import.meta.url)).text();
 const start=source.indexOf('export async function discoverMedia('),end=source.indexOf('/** Explicit shelf membership',start);
 if(start<0||end<0)throw Error('Discovery owner was not found.');
 return import(moduleUrl(`export const harnessId=${generation++};
 export const state={enabled:true,tmdb:true,seerr:false,fail:'',calls:[],adapters:0,resolutions:0};
 const adapter={trending:async()=>feed('trending'),recent:async kind=>{if(kind!=='movie')throw Error('Unexpected recent kind');return feed('recent');}};
 async function feed(section){state.calls.push(section);if(state.fail===section)throw Error('Controlled failure');return [];}
 const getFeatureConfig=async()=>({features:{screen:state.enabled}});
 const getTmdb=async()=>{state.adapters++;return state.tmdb?adapter:null;};
 const seerrDiscovery=async()=>state.seerr?adapter:null;
 const mapConcurrent=async items=>{if(items.length)throw Error('No provider content is invented by this admission test');return [];};
 const ingestMetadata=async()=>{throw Error('No ingestion expected for empty feeds');};
 const resolveDiscoveryItems=async ids=>{state.resolutions++;return ids;};
 ${source.slice(start,end)}`));
}

test('each named discovery bucket admits only its provider feed and ignores unrelated failures',async()=>{
 for(const section of ['trending','recent']){
  const {state,discoverMedia}=await owner();state.fail=section==='trending'?'recent':'trending';
  const result=await discoverMedia('unit-viewer',section);
  expect(state.calls).toEqual([section]);expect(result.providerUnavailable).toBe(false);expect(result.configured).toBe(true);
 }
});

test('the combined discovery owner keeps both feeds and resolves their result',async()=>{
 const {state,discoverMedia}=await owner();const result=await discoverMedia(null);
 expect(state.calls).toEqual(['trending','recent']);expect(state.resolutions).toBe(1);expect(result.providerUnavailable).toBe(false);
});

test('requested failures keep the existing discovery failure contract',async()=>{
 for(const section of ['trending','recent']){
  const {state,discoverMedia}=await owner();state.fail=section;
  const result=await discoverMedia('unit-viewer',section);
  expect(state.calls).toEqual([section]);expect(result.providerUnavailable).toBe(true);expect(result[section]).toEqual([]);
 }
});

test('combined discovery still reports a partial provider failure',async()=>{
 const {state,discoverMedia}=await owner();state.fail='recent';const result=await discoverMedia(null);
 expect(state.calls).toEqual(['trending','recent']);expect(result.providerUnavailable).toBe(true);
});

test('Seerr fallback has no recent feed and does not request trending for a recent bucket',async()=>{
 const {state,discoverMedia}=await owner();state.tmdb=false;state.seerr=true;
 const result=await discoverMedia('unit-viewer','recent');
 expect(state.calls).toEqual([]);expect(result.configured).toBe(true);expect(result.providerUnavailable).toBe(false);
});

test('disabled discovery admits no adapters or fallback catalogue query',async()=>{
 const {state,discoverMedia}=await owner();state.enabled=false;const result=await discoverMedia(null,'trending');
 expect(state.adapters).toBe(0);expect(state.resolutions).toBe(0);expect(result.items).toEqual([]);
});

test('missing providers preserve unconfigured fallback behavior',async()=>{
 const {state,discoverMedia}=await owner();state.tmdb=false;const result=await discoverMedia(null,'recent');
 expect(state.calls).toEqual([]);expect(state.resolutions).toBe(1);expect(result.configured).toBe(false);
});

test('the shared screen query forwards each selected bucket to the catalogue owner',async()=>{
 const source=await Bun.file(new URL('../src/lib/server/queries/discovery.ts',import.meta.url)).text();
 const start=source.indexOf('async function screenDiscovery('),end=source.indexOf('async function gameDiscovery(',start);
 if(start<0||end<0)throw Error('Screen discovery query was not found.');
 const module=await import(moduleUrl(`export const calls=[];const discoverMedia=async(...args)=>{calls.push(args);return {trending:[],recent:[],providerUnavailable:false};};const mediaViews=async()=>[];export ${source.slice(start,end)}`));
 for(const section of ['trending','recent'])await module.screenDiscovery('unit-viewer',section);
 expect(module.calls).toEqual([['unit-viewer','trending'],['unit-viewer','recent']]);
});

test('cancelled discovery does not hydrate cards after shared provider work completes',async()=>{
 const source=await Bun.file(new URL('../src/lib/server/queries/discovery.ts',import.meta.url)).text();
 const start=source.indexOf('async function screenDiscovery('),end=source.indexOf('async function gameDiscovery(',start);
 const module=await import(moduleUrl(`export let finish;export let hydrated=0;const discoverMedia=()=>new Promise(resolve=>finish=resolve);const mediaViews=async()=>{hydrated++;return [];};export ${source.slice(start,end)}`));
 const controller=new AbortController();const pending=module.screenDiscovery('viewer','trending',controller.signal);
 controller.abort();module.finish({trending:[],recent:[],providerUnavailable:false});
 await expect(pending).rejects.toThrow();expect(module.hydrated).toBe(0);
});
