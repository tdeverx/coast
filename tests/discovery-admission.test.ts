import {expect,test} from 'bun:test';

// Empty provider results isolate admission/error behavior. Actual membership,
// persistence and presentation are verified separately with the retained corpus.
let generation=0;
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(new Bun.Transpiler({loader:'ts'}).transformSync(source)).toString('base64')}`;
async function owner(){
 const source=await Bun.file(new URL('../src/lib/catalogue/service.server.ts',import.meta.url)).text();
 const start=source.indexOf('export async function discoverMedia(');
 if(start<0)throw Error('Discovery owner was not found.');
 return import(moduleUrl(`export const harnessId=${generation++};
 export const state={enabled:true,requests:true,tmdb:true,seerr:false,fail:'',calls:[],adapters:0,items:[]};
 const adapter={trending:async()=>{state.calls.push('seerr');return [];}};
 const getFeatureConfig=async()=>({features:{screen:state.enabled,requests:state.requests}});
 const screenListings=async(_kind,section)=>{state.adapters++;if(state.tmdb)state.calls.push(section);return {items:state.items,configured:state.tmdb,failed:state.fail===section};};
 const seerrDiscovery=async()=>state.seerr?adapter:null;
 const persistScreenListings=async items=>items.map(item=>item.id);
 ${source.slice(start)}`));
}

test('each named discovery bucket admits only its provider feed and ignores unrelated failures',async()=>{
 for(const section of ['trending','recent']){
  const {state,discoverMedia}=await owner();state.fail=section==='trending'?'recent':'trending';
  const result=await discoverMedia('unit-viewer',section);
  expect(state.calls).toEqual([section]);expect(result.providerUnavailable).toBe(false);expect(result.configured).toBe(true);
 }
});

test('the combined discovery owner returns ordered IDs from both feeds without projecting cards',async()=>{
 const {state,discoverMedia}=await owner();state.items=[{id:'second'},{id:'first'}];
 const result=await discoverMedia(null);
 expect(state.calls).toEqual(['trending','recent']);
 expect(result).toEqual({trending:['second','first'],recent:['second','first'],configured:true,providerUnavailable:false});
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
 expect(state.calls).toEqual([]);expect(result.configured).toBe(false);expect(result.providerUnavailable).toBe(false);
});

test('the linked Seerr fallback respects the viewer requests setting and never runs for guests',async()=>{
 const {state,discoverMedia}=await owner();state.tmdb=false;state.seerr=true;
 await discoverMedia(null,'trending');
 state.requests=false;await discoverMedia('unit-viewer','trending');
 expect(state.calls).toEqual([]);
 state.requests=true;await discoverMedia('unit-viewer','trending');
 expect(state.calls).toEqual(['seerr']);
});

test('disabled discovery admits no adapters or fallback catalogue query',async()=>{
 const {state,discoverMedia}=await owner();state.enabled=false;const result=await discoverMedia(null,'trending');
 expect(state.adapters).toBe(0);expect(result).toMatchObject({trending:[],recent:[]});
});

test('missing providers return empty IDs without a fallback catalogue read',async()=>{
 const {state,discoverMedia}=await owner();state.tmdb=false;const result=await discoverMedia(null,'recent');
 expect(state.calls).toEqual([]);expect(result).toMatchObject({recent:[],configured:false});
});

test('the shared screen query forwards each selected bucket to the catalogue owner',async()=>{
 const source=await Bun.file(new URL('../src/lib/server/queries/discovery.ts',import.meta.url)).text();
 const start=source.indexOf('async function screenDiscovery('),end=source.indexOf('async function gameDiscovery(',start);
 if(start<0||end<0)throw Error('Screen discovery query was not found.');
 const module=await import(moduleUrl(`export const calls=[];const discoverMedia=async(...args)=>{calls.push(args);return {trending:[],recent:[],providerUnavailable:false};};const mediaViewsForIds=async()=>[];${source.slice(start,end)} export {screenDiscovery};`));
 for(const section of ['trending','recent'])await module.screenDiscovery('unit-viewer',section);
 expect(module.calls).toEqual([['unit-viewer','trending',undefined],['unit-viewer','recent',undefined]]);
});

test('cancelled discovery does not hydrate cards after shared provider work completes',async()=>{
 const source=await Bun.file(new URL('../src/lib/server/queries/discovery.ts',import.meta.url)).text();
 const start=source.indexOf('async function screenDiscovery('),end=source.indexOf('async function gameDiscovery(',start);
 const module=await import(moduleUrl(`export let finish;export let hydrated=0;const discoverMedia=()=>new Promise(resolve=>finish=resolve);const mediaViewsForIds=async()=>{hydrated++;return [];};${source.slice(start,end)} export {screenDiscovery};`));
 const controller=new AbortController();const pending=module.screenDiscovery('viewer','trending',controller.signal);
 controller.abort();module.finish({trending:[],recent:[],providerUnavailable:false});
 await expect(pending).rejects.toThrow();expect(module.hydrated).toBe(0);
});
