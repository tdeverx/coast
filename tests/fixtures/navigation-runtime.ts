/** Controlled installed-source schedules promoted from the reviewed navigation proof.
 * Extract complete Kit owners and use the installed real Svelte store/tick/settled.
 * Browser, render/load and URL boundaries are diagnostic only: no application rows,
 * browser acceptance or performance result is fabricated by this fixture.
 */
import {createHash} from 'node:crypto';
import ts from 'typescript';
const {writable}:Pick<typeof import('svelte/store'),'writable'>=await import(new URL('../../node_modules/svelte/src/store/shared/index.js',import.meta.url).href);
const {tick,settled}:Pick<typeof import('svelte'),'tick'|'settled'>=await import(new URL('../../node_modules/svelte/src/internal/client/runtime.js',import.meta.url).href);
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fragment(s:string,name:string){
 const tree=ts.createSourceFile('installed.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const node=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
 if(!node)throw Error(`Installed owner missing: ${name}`);
 const text=node.getText(tree).replace(/^export /,'');
 return {text,startLine:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,endLine:tree.getLineAndCharacterOfPosition(node.end).line+1,sha256:sha(text)};
}
export function create(s:string){
 const names=['create_navigation','_goto','_before_navigate','_invalidate','navigate','run_on_navigate_callbacks','finish_navigation','update_state'];
 const optional=['release_on_navigate','retire_on_navigate'];
 const fragments=Object.fromEntries([...names,...optional.filter(name=>s.includes(`function ${name}(`))].map(name=>[name,fragment(s,name)]));
 const factory=new Function('actualWritable','actualTick','actualSettled',`
  const noop=()=>{},started=true,DEV=false,BROWSER=true,app={},base='';
  let navigation_token={},invalidation_token={},current={url:new URL('http://diagnostic.invalid/initial'),branch:[],nav:{},route:{id:'initial'}},rendering_error=null,has_navigated=false,is_navigating=false,updating=false;
  let current_history_index=0,current_navigation_index=0,current_reset_index=0,load_cache=null,current_a={};
  const HISTORY_METADATA_KEY='metadata',document={activeElement:null,body:{}};
  const commits=[],callbacks=[],navigationEvents=[],historyEvents=[],focusEvents=[],guardCalls=[],results=new Map(),callbackGates=new Map(),renderGates=new Map(),loadGates=new Map(),expectedTokens=new Map();let tickCalls=0,settledCalls=0;
  const before_navigate_callbacks=new Set(),on_navigate_callbacks=new Set(),after_navigate_callbacks=new Set(),on_navigate_registrations=new Map(),resetters=new Set();
  let navigatingStore=null,pending_invalidate=null,force_invalidation=false;const query_map=new Map(),live_query_map=new Map(),page={state:{},url:current.url,shallow:null};
  const store=actualWritable(null);store.subscribe(value=>navigatingStore=value);
  const set_navigation=value=>store.set(value);
  const history={replaceState:(_state,_title,url)=>historyEvents.push({type:'replace',path:url.pathname}),pushState:(_state,_title,url)=>historyEvents.push({type:'push',path:url.pathname})};
  const clear_onward_history=noop,capture_snapshot=noop,capture_scroll=noop,capture_navigation_snapshot=noop,delete_navigation_snapshot=noop,restore_navigation_snapshot=noop,set_history_options=noop,reset_invalidation=noop,current_registrations=()=>[];
  const scroll_state=()=>({x:0,y:0}),reset_focus=()=>focusEvents.push('reset'),restore_snapshot=noop,restore_scroll=noop,blur_active_element=noop;
  const tick=()=>{tickCalls++;return actualTick();};
  const settled=()=>{settledCalls++;const gate=renderGates.get(current.route.id);return (gate?.promise??Promise.resolve()).then(()=>actualSettled());};
  const update_page=value=>Object.assign(page,value);
  const apply_navigation_result=result=>{commits.push({label:result.props.label,currentToken:navigation_token===expectedTokens.get(result.props.label)});update_page(result.props.page);};
  const get_navigation_intent=async(url,invalidating)=>({id:url.pathname,url,params:{},route:{id:url.pathname.slice(1)},invalidating});
  const load_route=async(intent)=>{const value=results.get(intent.id);const gate=loadGates.get((intent.invalidating?'I:':'N:')+intent.id);if(gate)await gate.promise;if(value instanceof Error)throw value;if(intent.invalidating&&value?.props)expectedTokens.set(value.props.label,navigation_token);return value;};
  const discard_load_cache=()=>{void load_cache?.fork?.then(f=>f?.discard());load_cache=null;current_a={};};
  const resolve_url=url=>new URL(url,'http://diagnostic.invalid'),push_invalidated=noop,cache_entries=map=>map.entries(),stringify=JSON.stringify,parse=JSON.parse;
  ${Object.values(fragments).map(value=>value.text).join('\n')}
  const create_navigation_original=create_navigation;
  create_navigation=function(...args){const nav=create_navigation_original(...args);nav.navigation.complete.then(()=>navigationEvents.push({label:nav.navigation.to?.route.id,phase:'fulfilled'}),()=>navigationEvents.push({label:nav.navigation.to?.route.id,phase:'rejected'}));return nav;};
  const loaded=(label,url)=>({type:'loaded',state:{route:{id:url.pathname.slice(1)},url,branch:[],params:{}},props:{label,page:{url,status:200,state:{},shallow:null}}});
  const shared=()=>callbacks.push('shared');
  on_navigate_callbacks.add(async(nav)=>{const id=nav.to.route.id;const gate=callbackGates.get(id);if(gate)await gate.promise;return ()=>callbacks.push(id);});
  return {commits,callbacks,navigationEvents,historyEvents,focusEvents,guardCalls,callbackGates,renderGates,loadGates,page,subscribe:store.subscribe,get runtimeCalls(){return {tickCalls,settledCalls};},guard(cancel=false){before_navigate_callbacks.add(nav=>{guardCalls.push(nav.to?.route.id);if(cancel)nav.cancel();});},prepare(label,redirect){const url=new URL('http://diagnostic.invalid/'+label);results.set('/'+label,redirect?{type:'redirect',location:'/'+redirect}:loaded(label,url));},external(){is_navigating=true;},get flags(){return {isNavigating:is_navigating,updating,navigatingStoreActive:!!navigatingStore};},get registeredAfterCallbacks(){return after_navigate_callbacks.size;},invalidate(label,options={}){const url=current.url;results.set(url.pathname,options.error??(options.redirect?{type:'redirect',location:'/'+options.redirect}:loaded(label,url)));if(options.gate)loadGates.set('I:'+url.pathname,options.gate);return _invalidate(options.resetState??false);},get registrations(){return on_navigate_registrations.size;},setShared(){on_navigate_callbacks.clear();on_navigate_callbacks.add(async(nav)=>{const gate=callbackGates.get(nav.to.route.id);if(gate)await gate.promise;return shared;});},after(fn){after_navigate_callbacks.add(fn);return ()=>after_navigate_callbacks.delete(fn);},setCache(id,fork){load_cache={id:'/'+id,fork};},supersede(){navigation_token={};},shallow(label,state){const url=new URL('http://diagnostic.invalid/'+label);return update_state({url,params:{},route:{id:label}},state,{replace:false,persist_state:false,reset:false},'goto');},navigate(label){const navToken={};expectedTokens.set(label,navToken);const url=new URL('http://diagnostic.invalid/'+label);results.set('/'+label,loaded(label,url));return navigate({type:'goto',url,reset:false,nav_token:navToken});}};
 `);
 return {value:factory(writable,tick,settled),source:fragments.navigate,fragments};
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
  cases.push({name:'Kit 3 refresh can finish while navigation is pending without stealing navigation ownership',commits:h.commits,callbacks:h.callbacks,events:h.navigationEvents,retainedFlags,correct:JSON.stringify(h.commits.map((c:any)=>c.label))==='["I","A"]'&&JSON.stringify(h.callbacks)==='["A"]'&&!retainedFlags.isNavigating&&!retainedFlags.updating&&h.registrations===0});
 }
 return cases;}

const idle=(flags:any)=>!flags.isNavigating&&!flags.updating&&!flags.navigatingStoreActive;
export async function runInvalidationSchedules(source:string){const cases:any[]=[];
 {
  const h=create(source).value,a=deferred<void>(),i=deferred<void>();h.callbackGates.set('A',a);
  const first=h.navigate('A');await turn();const refresh=h.invalidate('I',{gate:i});await turn();await h.navigate('B');i.resolve();await refresh;a.resolve();await first;
  cases.push({name:'stale refresh and old navigation cannot replace newer B',correct:JSON.stringify(h.commits.map((c:any)=>c.label))==='["B"]'&&idle(h.flags)&&h.registrations===0});
 }
 {
  const h=create(source).value;h.guard(true);await h.navigate('A');
  cases.push({name:'cancelled navigation preserves idle owner and commits nothing',correct:h.commits.length===0&&idle(h.flags)});
 }
 {
  const h=create(source).value;await h.invalidate('I');
  cases.push({name:'refresh-only does not manufacture history or navigation hooks',correct:h.commits.length===1&&h.callbacks.length===0&&h.historyEvents.length===0&&idle(h.flags)});
 }
 {
  const h=create(source).value;h.page.state={friendsPopover:true};await h.invalidate('I');
  cases.push({name:'refresh preserves shallow state while deprecated invalidation can reset it',correct:h.page.state.friendsPopover===true});
  await h.invalidate('J',{resetState:true});cases.push({name:'explicit state reset remains available',correct:Object.keys(h.page.state).length===0});
 }
 {
  const h=create(source).value,a=deferred<void>(),b=deferred<void>();h.callbackGates.set('A',a);h.callbackGates.set('B',b);
  const first=h.shallow('A',{panel:'A'});await turn();const second=h.shallow('B',{panel:'B'});await turn();a.resolve();await first;b.resolve();await second;
  cases.push({name:'superseded shallow callback cannot publish its old panel state',correct:h.page.state.panel==='B'&&JSON.stringify(h.callbacks)==='["B"]'&&h.registrations===0&&idle(h.flags)});
 }
 {
  const h=create(source).value,b=deferred<void>();h.callbackGates.set('B',b);let armed=false,second:Promise<void>|undefined;
  const unsubscribe=h.subscribe((value:any)=>{if(armed&&value===null){armed=false;second=h.navigate('B');}});armed=true;await h.navigate('A');await turn();const flags=h.flags;b.resolve();if(second)await second;unsubscribe();
  cases.push({name:'real writable subscriber can start B during A completion without A clearing B',correct:!!second&&flags.isNavigating&&flags.updating&&flags.navigatingStoreActive&&idle(h.flags)});
 }
 {
  const h=create(source).value,b=deferred<void>();h.callbackGates.set('B',b);let second:Promise<void>|undefined;
  const remove=h.after((nav:any)=>{if(nav.to.route.id==='A')second=h.navigate('B');});await h.navigate('A');await turn();const flags=h.flags;b.resolve();if(second)await second;remove();
  cases.push({name:'afterNavigate reentrancy retains the new navigation indicator and flags',correct:!!second&&flags.isNavigating&&flags.updating&&flags.navigatingStoreActive&&idle(h.flags)});
 }
 {
  const h=create(source).value;h.external();await h.invalidate('I');
  cases.push({name:'refresh does not clear an external navigation',correct:h.flags.isNavigating&&!h.flags.updating});
 }
 {
  const h=create(source).value;let failed=false;try{await h.invalidate('I',{error:new Error('controlled load failure')});}catch{failed=true;}
  cases.push({name:'refresh load failure propagates without inventing a page commit',correct:failed&&h.commits.length===0&&idle(h.flags)});
 }
 return cases;}
