/** Controlled installed-source schedules promoted from the reviewed navigation proof.
 * Extract complete Kit owners and use the installed real Svelte store/tick/settled.
 * Browser, render/load and URL boundaries are diagnostic only: no application rows,
 * browser acceptance or performance result is fabricated by this fixture.
 */
import {createHash} from 'node:crypto';
const {writable}:Pick<typeof import('svelte/store'),'writable'>=await import(new URL('../../node_modules/svelte/src/store/shared/index.js',import.meta.url).href);
const {tick,settled}:Pick<typeof import('svelte'),'tick'|'settled'>=await import(new URL('../../node_modules/svelte/src/internal/client/runtime.js',import.meta.url).href);
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fragment(s:string,start:string,end:string){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<0)throw Error('Source markers missing');return {text:s.slice(a,b),startLine:s.slice(0,a).split('\n').length,endLine:s.slice(0,b).split('\n').length-1,sha256:sha(s.slice(a,b))};}
export function create(s:string){
 const invalidation=fragment(s,'async function _invalidate(','\nfunction reset_invalidation()');
 const createNavigation=fragment(s,'function create_navigation(','\n/**\n * TODO: remove this in 3.0');
 const goto=fragment(s,'export async function _goto(','\n/**');
 const navigation=fragment(s,'async function navigate({','\n/**\n * Does a full page reload');
 const start=s.indexOf('function _before_navigate({'),end=s.indexOf('\n/**',start+20),before=s.slice(start,end);
 const helperStart=s.indexOf('/** @type {Set<Array<'),helperEnd=s.indexOf("/** @type {import('./types.js').NavigationState",helperStart);
 const helpers=helperStart<0?'const on_navigate_registrations = new Set();':s.slice(helperStart,helperEnd);
 const factory=new Function('actualWritable','actualTick','actualSettled',`
  const noop=()=>{},started=true,DEV=false,app={},base='';
  let token={},current={url:new URL('http://diagnostic.invalid/initial'),branch:[],nav:{},route:{id:'initial'}},rendering_error=null,has_navigated=false,is_navigating=false,updating=false;
  let current_history_index=0,current_navigation_index=0,autoscroll=false,load_cache=null,current_a={};
  const HISTORY_INDEX='history',NAVIGATION_INDEX='navigation',STATES_KEY='state';
  const document={activeElement:null,body:{}};class HTMLElement{}
  const commits=[],callbacks=[],navigationEvents=[],historyEvents=[],focusEvents=[],guardCalls=[],results=new Map(),callbackGates=new Map(),renderGates=new Map(),loadGates=new Map(),expectedTokens=new Map();let tickCalls=0,settledCalls=0;
  const before_navigate_callbacks=new Set(),on_navigate_callbacks=new Set(),after_navigate_callbacks=new Set();
  ${helpers}
  let navigatingStore=null,pending_invalidate=null,force_invalidation=false;const query_map=new Map(),live_query_map=new Map(),page={state:{}};
  const stores={navigating:actualWritable(null)},navigating={current:null};stores.navigating.subscribe(value=>navigatingStore=value);
  const history={replaceState:(_state,_title,url)=>historyEvents.push({type:'replace',path:url.pathname}),pushState:(_state,_title,url)=>historyEvents.push({type:'push',path:url.pathname})},clear_onward_history=()=>{},capture_snapshot=()=>{},update_scroll_positions=()=>{},reset_invalidation=()=>{};
  const update=()=>{},scroll_state=()=>({x:0,y:0}),get_id=()=>'',reset_focus=()=>focusEvents.push('reset'),restore_snapshot=()=>{};
  const svelte={tick:()=>{tickCalls++;return actualTick();},settled:()=>{settledCalls++;const gate=renderGates.get(current.route.id);return (gate?.promise??Promise.resolve()).then(()=>actualSettled());}};
  const root={$set(props){commits.push({label:props.label,currentToken:token===expectedTokens.get(props.label)});}};
  const get_navigation_intent=async(url,invalidating)=>({id:url.pathname,url,params:{},route:{id:url.pathname.slice(1)},invalidating});
  const load_route=async(intent)=>{const value=results.get(intent.id);const gate=loadGates.get((intent.invalidating?'I:':'N:')+intent.id);if(gate)await gate.promise;if(value instanceof Error)throw value;if(intent.invalidating&&value?.props)expectedTokens.set(value.props.label,token);return value;};
  const discard_load_cache=()=>{void load_cache?.fork?.then(f=>f?.discard());load_cache=null;current_a={};};
  const resolve_url=url=>new URL(url,'http://diagnostic.invalid'),push_invalidated=()=>{};
  ${createNavigation.text}
  const create_navigation_original=create_navigation;
  create_navigation=function(...args){const nav=create_navigation_original(...args);nav.navigation.complete.then(()=>navigationEvents.push({label:nav.navigation.to?.route.id,phase:'fulfilled'}),()=>navigationEvents.push({label:nav.navigation.to?.route.id,phase:'rejected'}));return nav;};
  ${goto.text.replace('export ','')}
  ${before}
  ${invalidation.text}
  ${navigation.text}
  const shared=()=>callbacks.push('shared');
  on_navigate_callbacks.add(async(nav)=>{const id=nav.to.route.id;const gate=callbackGates.get(id);if(gate)await gate.promise;return ()=>callbacks.push(id);});
  return {commits,callbacks,navigationEvents,historyEvents,focusEvents,guardCalls,callbackGates,renderGates,loadGates,subscribe:stores.navigating.subscribe,get runtimeCalls(){return {tickCalls,settledCalls};},guard(cancel=false){before_navigate_callbacks.add(nav=>{guardCalls.push(nav.to?.route.id);if(cancel)nav.cancel();});},prepare(label,redirect){const url=new URL('http://diagnostic.invalid/'+label);results.set('/'+label,redirect?{type:'redirect',location:'/'+redirect}:{type:'loaded',state:{route:{id:label},url,branch:[]},props:{label,page:{url,status:200}}});},external(){is_navigating=true;},clearIndicatorForDiagnostic(){is_navigating=false;updating=false;stores.navigating.set(navigating.current=null);},get flags(){return {isNavigating:is_navigating,updating,navigatingStoreActive:!!navigatingStore};},get registeredAfterCallbacks(){return after_navigate_callbacks.size;},invalidate(label,options={}){const url=current.url;results.set(url.pathname,options.error??(options.redirect?{type:'redirect',location:'/'+options.redirect}:{type:'loaded',state:{route:{id:url.pathname.slice(1)},url,branch:[]},props:{label,page:{url,status:200}}}));if(options.gate)loadGates.set('I:'+url.pathname,options.gate);return _invalidate(options.includeLoadFunctions!==false);},get registrations(){return on_navigate_registrations.size;},setShared(){on_navigate_callbacks.clear();on_navigate_callbacks.add(async(nav)=>{const gate=callbackGates.get(nav.to.route.id);if(gate)await gate.promise;return shared;});},setCache(id,fork){load_cache={id:'/'+id,fork};},supersede(){token={};},navigate(label){const navToken={};expectedTokens.set(label,navToken);const url=new URL('http://diagnostic.invalid/'+label);results.set('/'+label,{type:'loaded',state:{route:{id:label},url,branch:[]},props:{label,page:{url,status:200}}});return navigate({type:'goto',url,keepfocus:true,noscroll:true,nav_token:navToken});}};
 `);
 return {value:factory(writable,tick,settled),source:navigation,fragments:{navigation,invalidation,createNavigation,goto}};
}
export function deferred<T>(){let resolve!:(value:T)=>void;return {promise:new Promise<T>(done=>resolve=done),resolve};}
export const turn=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
export async function runNavigationSchedules(source:string){const cases:any[]=[];
 {
  const h=create(source).value,a=deferred<void>(),b=deferred<void>();h.callbackGates.set('A',a);h.callbackGates.set('B',b);
  const first=h.navigate('A');await turn();const second=h.navigate('B');await turn();a.resolve();await first;b.resolve();await second;
  cases.push({name:'superseded during onNavigate, older callbacks resolve first',commits:h.commits,callbacks:h.callbacks,events:h.navigationEvents,remainingRegistrations:h.registrations,correct:!h.commits.some((c:any)=>c.label==='A')&&JSON.stringify(h.callbacks)==='["B"]'&&h.registrations===0});
 }
 {
  const h=create(source).value,a=deferred<void>(),b=deferred<void>();h.setShared();h.renderGates.set('A',a);h.renderGates.set('B',b);
  const first=h.navigate('A');await turn();const second=h.navigate('B');await turn();a.resolve();await first;b.resolve();await second;
  cases.push({name:'old render abort cannot delete current registration of same returned function',commits:h.commits,callbacks:h.callbacks,events:h.navigationEvents,remainingRegistrations:h.registrations,correct:h.callbacks.length===1&&h.registrations===0});
 }
 {
  const h=create(source).value,a=deferred<void>();h.setShared();h.renderGates.set('A',a);
  const first=h.navigate('A');await turn();await h.navigate('B');a.resolve();await first;
  cases.push({name:'newer navigation finishes before old render abort, only current callback dispatches',commits:h.commits,callbacks:h.callbacks,events:h.navigationEvents,remainingRegistrations:h.registrations,correct:h.callbacks.length===1&&h.registrations===0});
 }
 {
  const h=create(source).value,a=deferred<void>(),b=deferred<void>(),fork=deferred<any>();let discards=0,forkCommits=0;
  h.callbackGates.set('A',a);h.callbackGates.set('B',b);h.setCache('A',fork.promise);
  const first=h.navigate('A');await turn();const second=h.navigate('B');await turn();a.resolve();await turn();fork.resolve({discard(){discards++;},commit(){forkCommits++;return Promise.resolve();}});await first;b.resolve();await second;await turn();
  cases.push({name:'superseded owner discards preload fork already removed from load_cache',discards,forkCommits,callbacks:h.callbacks,remainingRegistrations:h.registrations,correct:discards===1&&forkCommits===0&&JSON.stringify(h.callbacks)==='["B"]'&&h.registrations===0});
 }
 {
  const h=create(source).value,fork=deferred<any>();let discards=0,forkCommits=0;
  h.setCache('A',fork.promise);const first=h.navigate('A');await turn();await h.navigate('B');fork.resolve({discard(){discards++;},commit(){forkCommits++;return Promise.resolve();}});await first;await turn();
  cases.push({name:'additional diagnostic: superseded during pending preload fork await after hook gate',discards,forkCommits,commits:h.commits,callbacks:h.callbacks,remainingRegistrations:h.registrations,correct:discards===1&&forkCommits===0&&h.registrations===0});
 }
 {
  const h=create(source).value,a=deferred<void>();h.renderGates.set('A',a);
  const first=h.navigate('A');await turn();await h.navigate('B');a.resolve();await first;
  cases.push({name:'new navigation finishes first, distinct aborted callback never dispatches',callbacks:h.callbacks,remainingRegistrations:h.registrations,correct:JSON.stringify(h.callbacks)==='["B"]'&&h.registrations===0});
 }
 {
  const h=create(source).value;await h.navigate('A');
  cases.push({name:'negative control successful single navigation preserves one commit and returned callback',commits:h.commits,callbacks:h.callbacks,remainingRegistrations:h.registrations,correct:h.commits.length===1&&h.commits[0].currentToken&&JSON.stringify(h.callbacks)==='["A"]'&&h.registrations===0});
 }
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);
  const first=h.navigate('A');await turn();await h.invalidate('I');a.resolve();await first;
  await turn();const retainedFlags=h.flags;
  cases.push({name:'invalidation-only supersession blocks stale page commit and reports navigation owner flags',commits:h.commits,callbacks:h.callbacks,events:h.navigationEvents,retainedFlags,runtimeCalls:h.runtimeCalls,registeredAfterCallbacks:h.registeredAfterCallbacks,remainingRegistrations:h.registrations,correct:JSON.stringify(h.commits.map((c:any)=>c.label))==='["I"]'&&h.registeredAfterCallbacks===0&&h.registrations===0,flagsVerifiedInSeparateSuite:true});
 }
 return cases;}

const idle=(flags:any)=>!flags.isNavigating&&!flags.updating&&!flags.navigatingStoreActive;
export async function runInvalidationSchedules(source:string){const cases:any[]=[];
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);const first=h.navigate('A');await turn();await h.invalidate('I');a.resolve();await first;await turn();
  const flagsAfterI=h.flags,runtimeCalls=h.runtimeCalls;h.guard(true);await h.navigate('B');await turn();
  cases.push({name:'successful invalidation clears only superseded internal navigation and next dirty guard can cancel',flagsAfterI,runtimeCalls,guardCalls:h.guardCalls,events:h.navigationEvents,commits:h.commits,correct:idle(flagsAfterI)&&JSON.stringify(h.guardCalls)==='["B"]'&&!h.commits.some((c:any)=>c.label==='A'||c.label==='B')});
 }
 {
  const h=create(source).value,a=deferred<void>(),i=deferred<void>(),b=deferred<void>();h.callbackGates.set('A',a);h.callbackGates.set('B',b);
  const first=h.navigate('A');await turn();const invalidate=h.invalidate('I',{gate:i});await turn();const second=h.navigate('B');await turn();i.resolve();await invalidate;await turn();const flagsWhileB=h.flags;a.resolve();await first;await turn();const flagsAfterA=h.flags;b.resolve();await second;await turn();
  cases.push({name:'pending invalidation cannot clear newer B owner on its own stale exit',flagsWhileB,flagsAfterA,finalFlags:h.flags,commits:h.commits,events:h.navigationEvents,correct:flagsWhileB.isNavigating&&flagsWhileB.updating&&flagsWhileB.navigatingStoreActive&&flagsAfterA.isNavigating&&idle(h.flags)&&!h.commits.some((c:any)=>c.label==='I'||c.label==='A')});
 }
 {
  const h=create(source).value,a=deferred<void>(),b=deferred<void>();h.callbackGates.set('A',a);h.callbackGates.set('B',b);const first=h.navigate('A');await turn();let armed=true,second:Promise<void>|undefined;
  const unsubscribe=h.subscribe((value:any)=>{if(armed&&value===null){armed=false;second=h.navigate('B');}});await h.invalidate('I');await turn();const startedSynchronously=!!second,flagsWhileB=h.flags;a.resolve();await first;await turn();const flagsAfterA=h.flags;b.resolve();if(second)await second;await turn();unsubscribe();
  cases.push({name:'synchronous real writable subscriber may start B during I reset without I clearing it afterward',startedSynchronously,flagsWhileB,flagsAfterA,finalFlags:h.flags,correct:startedSynchronously&&flagsWhileB.isNavigating&&flagsWhileB.updating&&flagsWhileB.navigatingStoreActive&&flagsAfterA.isNavigating&&idle(h.flags)});
 }
 {
  const h=create(source).value;h.guard();await h.invalidate('I');await turn();const flagsAfterI=h.flags,historyBeforeNext=h.historyEvents.length;await h.navigate('B');await turn();
  cases.push({name:'idle invalidation stays idle and adds no history entry',flagsAfterI,historyBeforeNext,guardCalls:h.guardCalls,correct:idle(flagsAfterI)&&historyBeforeNext===0&&JSON.stringify(h.guardCalls)==='["B"]'&&idle(h.flags)});
 }
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);const first=h.navigate('A');await turn();let rejected=false;try{await h.invalidate('I',{error:Error('Controlled invalidation failure')});}catch{rejected=true;}a.resolve();await first;await turn();const flagsAfterFailure=h.flags;h.guard(true);await h.navigate('B');await turn();
  cases.push({name:'invalidation load failure preserves rejection and releases only superseded internal owner',rejected,flagsAfterFailure,guardCalls:h.guardCalls,events:h.navigationEvents,correct:rejected&&idle(flagsAfterFailure)&&JSON.stringify(h.guardCalls)==='["B"]'&&h.navigationEvents.some((e:any)=>e.label==='A'&&e.phase==='rejected')});
 }
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);const first=h.navigate('A');await turn();h.prepare('R','R2');h.prepare('R2');h.guard();await h.invalidate('I',{redirect:'R'});a.resolve();await first;await turn();
  cases.push({name:'invalidation redirect chain becomes one live navigation with one beforeNavigate guard',guardCalls:h.guardCalls,events:h.navigationEvents,commits:h.commits,flags:h.flags,historyEvents:h.historyEvents,correct:JSON.stringify(h.guardCalls)==='["R"]'&&h.commits.length===1&&h.commits[0].label==='R2'&&idle(h.flags)&&h.navigationEvents.some((e:any)=>e.label==='A'&&e.phase==='rejected')});
 }
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);const first=h.navigate('A');await turn();h.prepare('R');h.guard(true);await h.invalidate('I',{redirect:'R'});a.resolve();await first;await turn();
  cases.push({name:'dirty guard can cancel invalidation redirect without fulfilling aborted original navigation',guardCalls:h.guardCalls,events:h.navigationEvents,commits:h.commits,flags:h.flags,correct:JSON.stringify(h.guardCalls)==='["R"]'&&h.commits.length===0&&idle(h.flags)&&h.navigationEvents.some((e:any)=>e.label==='A'&&e.phase==='rejected')&&h.navigationEvents.some((e:any)=>e.label==='R'&&e.phase==='rejected')});
 }
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);const first=h.navigate('A');await turn();const one=h.invalidate('I1'),two=h.invalidate('I2');await Promise.all([one,two]);a.resolve();await first;await turn();
  cases.push({name:'synchronous invalidations retain existing batching and settle one current refresh',commits:h.commits,flags:h.flags,correct:h.commits.length===1&&h.commits[0].label==='I2'&&idle(h.flags)});
 }
 {
  const h=create(source).value;h.external();await h.invalidate('I');await turn();
  cases.push({name:'external leave suppression with no internal current navigation remains intact',flags:h.flags,correct:h.flags.isNavigating&&!h.flags.updating&&!h.flags.navigatingStoreActive});
 }
 {
  const h=create(source).value,a=deferred<void>();h.callbackGates.set('A',a);const first=h.navigate('A');await turn();await h.invalidate('I',{includeLoadFunctions:false});a.resolve();await first;await turn();
  cases.push({name:'query-only refresh supersedes pending internal navigation without adding route/history work',flags:h.flags,commits:h.commits,events:h.navigationEvents,correct:idle(h.flags)&&h.commits.length===0&&h.navigationEvents.some((e:any)=>e.label==='A'&&e.phase==='rejected')});
 }
 {
  const h=create(source).value,a=deferred<void>();h.renderGates.set('A',a);const first=h.navigate('A');await turn();await h.invalidate('I');await turn();const registrationsAfterI=h.registrations,entriesAfterI=h.registeredAfterCallbacks;a.resolve();await first;await turn();
  cases.push({name:'invalidation releases old returned callbacks before a deliberately held render settles',registrationsAfterI,entriesAfterI,flags:h.flags,correct:registrationsAfterI===0&&entriesAfterI===0&&idle(h.flags)});
 }
 {
  const h=create(source).value,a=deferred<void>();h.renderGates.set('A',a);const first=h.navigate('A');await turn();h.clearIndicatorForDiagnostic();await h.invalidate('I');await turn();const registrationsAfterI=h.registrations,entriesAfterI=h.registeredAfterCallbacks;a.resolve();await first;await turn();
  cases.push({name:'supplementary flagless retained registration is still obsolete under the new invalidation token',registrationsAfterI,entriesAfterI,flags:h.flags,correct:registrationsAfterI===0&&entriesAfterI===0&&idle(h.flags)});
 }
 {
  const h=create(source).value,a=deferred<void>(),b=deferred<void>();h.renderGates.set('A',a);h.renderGates.set('B',b);const first=h.navigate('A');await turn();let armed=true,second:Promise<void>|undefined;const unsubscribe=h.subscribe((value:any)=>{if(armed&&value===null){armed=false;second=h.navigate('B');}});await h.invalidate('I');await turn();const beforeARelease={registrations:h.registrations,entries:h.registeredAfterCallbacks,flags:h.flags};a.resolve();await first;await turn();const afterARelease={registrations:h.registrations,entries:h.registeredAfterCallbacks,flags:h.flags};b.resolve();if(second)await second;await turn();unsubscribe();
  cases.push({name:'I synchronously drops old A entries then subscriber-started B registration survives A late render abort',beforeARelease,afterARelease,callbacks:h.callbacks,flags:h.flags,correct:!!second&&beforeARelease.registrations===1&&beforeARelease.entries===2&&afterARelease.registrations===1&&afterARelease.entries===2&&afterARelease.flags.isNavigating&&JSON.stringify(h.callbacks)==='["B"]'&&idle(h.flags)});
 }
 return cases;
}
