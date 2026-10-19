import {expect,test} from 'bun:test';
import {compile,parse} from 'svelte/compiler';
import ts from 'typescript';

const read=async(path:string)=>Bun.file(new URL('../'+path,import.meta.url)).text();
function functionSource(source:string,name:string){
 const tree=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);
 const node=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
 if(!node)throw Error(`Missing source function ${name}`);
 return new Bun.Transpiler({loader:'ts'}).transformSync(node.getText(tree).replace(/^export /,''));
}
const kit=await read('node_modules/@sveltejs/kit/src/runtime/client/client.js');
const kitFunctions=['unregister_after_navigate','_invalidate','get_navigation_result_from_branch','clone_page','pushState','replaceState','invalidate','invalidateAll','refreshAll'];
const installedOwner=kitFunctions.map(name=>functionSource(kit,name)).join('\n');
const client=await read('src/lib/ui/client.ts'),friends=await read('src/lib/ui/panels/friends.svelte.ts'),layout=await read('src/routes/+layout.svelte');
const friendsOpen=layout.match(/const friendsOpen=\$derived\(([^\n]+)\);/u)![1];

/** Real installed state owners; diagnostic route data and history/root I/O are controlled.
 * This is not a DOM, actual-data or natural concurrency reproduction. */
function navigation(){
 return new Function(`
 const BROWSER=true,DEV=false,base='',__SVELTEKIT_EXPERIMENTAL_USE_TRANSFORM_ERROR__=false;
 const data={user:{id:'diagnostic-viewer'},capabilities:{social:true}},location={href:'https://example.invalid/settings/jobs'},window={location};
 const page={state:{},url:new URL(location.href),data:{},error:null,form:null,params:{},route:{id:'/settings/jobs'},status:200};
 let current={url:new URL(location.href),branch:[{data:{revision:0},node:{component:()=>{}}}],nav:{},error:null};
 let token={},pending_invalidate=null,force_invalidation=false,current_history_index=0,current_navigation_index=0,has_navigated=false,held=null,revision=0;
 const query_map=new Map(),live_query_map=new Map(),invalidated=[],HISTORY_INDEX='history',NAVIGATION_INDEX='navigation',PAGE_URL_KEY='page',STATES_KEY='state';
 const on_navigate_registrations=new Set(),after_navigate_callbacks=new Set(),navigating={current:null},stores={navigating:{set:()=>{}}};let is_navigating=false,updating=false;
 const noop=()=>{},discard_load_cache=()=>{},create_remote_key=()=>'',reset_invalidation=()=>{force_invalidation=false;},update_scroll_positions=()=>{},clear_onward_history=()=>{},untrack=fn=>fn();
 const root={$set:()=>{}},update=value=>Object.assign(page,value),compact=values=>values.filter(Boolean),normalize_path=path=>path;
 const history={pushState:(_state,_title,url)=>{location.href=String(url);},replaceState:(_state,_title,url)=>{location.href=String(url);}};
 const resolve_url=url=>new URL(url,location.href),push_invalidated=key=>invalidated.push(key);
 const get_navigation_intent=async url=>({url:new URL(url)});
 const load_route=async intent=>{const wait=held;if(wait){wait.enter();await wait.promise;}return get_navigation_result_from_branch({url:intent.url,params:{},branch:[{data:{revision:++revision},node:current.branch[0].node}],status:200,error:null,route:{id:'/settings/jobs'}});};
 const _goto=()=>{throw Error('Unexpected redirect');};
 ${installedOwner}
 ${functionSource(client,'refreshRouteDependencies')}
 ${functionSource(friends,'openFriends')}
 ${functionSource(friends,'closeFriends')}
 return {page,openFriends,closeFriends,refreshRouteDependencies,invalidate,isOpen:()=>${friendsOpen},get address(){return location.href;},
  hold(){let release,enter;const promise=new Promise(resolve=>release=resolve),started=new Promise(resolve=>enter=resolve);held={promise,enter};return {started,release};}};
 `)();
}

test('installed direct invalidation loses shallow demand while the shared open-overlay refresh preserves it',async()=>{
 const before=navigation();before.openFriends();expect(before.isOpen()).toBe(true);await before.invalidate('coast:settings');
 expect(before.isOpen()).toBe(false);expect(new URL(before.address).searchParams.get('friends')).toBe('true');
 before.openFriends();expect(before.isOpen()).toBe(false);
 const current=navigation();current.openFriends();await current.refreshRouteDependencies(['settings']);
 expect(current.isOpen()).toBe(true);expect(new URL(current.address).searchParams.get('friends')).toBe('true');current.closeFriends();expect(current.isOpen()).toBe(false);
});

test('installed open/close during a held refresh remains an explicit unmodified ownership boundary',async()=>{
 const opened=navigation(),opening=opened.hold(),ordinary=opened.refreshRouteDependencies(['settings']);await opening.started;
 opened.openFriends();opening.release();await ordinary;expect(opened.isOpen()).toBe(false);expect(new URL(opened.address).searchParams.get('friends')).toBe('true');
 const closed=navigation();closed.openFriends();const closing=closed.hold(),preserving=closed.refreshRouteDependencies(['settings']);await closing.started;
 closed.closeFriends();closing.release();await preserving;expect(closed.isOpen()).toBe(true);expect(new URL(closed.address).searchParams.has('friends')).toBe(false);
 // These assert known residual schedules, not successful mid-flight recovery.
});

const paths=['src/lib/ui/components/JobsSettings.svelte','src/routes/settings/[[section]]/+page.svelte','src/routes/onboarding/+page.svelte','src/routes/music/+page.svelte','src/routes/games/+page.svelte'];
const components=await Promise.all(paths.map(read));
test('changed refresh consumers compile with their complete client and server templates',()=>{
 for(let index=0;index<paths.length;index++)for(const generate of ['client','server'] as const)
  expect(()=>compile(components[index],{filename:paths[index],generate})).not.toThrow();
});

const jobsScript=components[0].match(/<script[^>]*>([\s\S]*?)<\/script>/u)![1];
const jobsTree=ts.createSourceFile('jobs.ts',jobsScript,ts.ScriptTarget.Latest,true);
const mount=(jobsTree.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(jobsTree)==='onMount') as ts.ExpressionStatement).expression as ts.CallExpression;
const mountCode=new Bun.Transpiler({loader:'ts'}).transformSync('const mount='+mount.arguments[0].getText(jobsTree)+';');
function jobs(refreshRouteDependencies:(keys:string[])=>Promise<void>,preview=false){
 const timers=new Set<()=>void>(),intervals:number[]=[],document={hidden:false};
 const mount=new Function('refreshRouteDependencies','preview','document','setInterval','clearInterval',mountCode+';return mount;')(
  refreshRouteDependencies,preview,document,(callback:()=>void,ms:number)=>{timers.add(callback);intervals.push(ms);return callback;},(callback:()=>void)=>timers.delete(callback));
 return {timers,intervals,document,mount,tick:()=>timers.forEach(callback=>callback())};
}
const turn=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('real Jobs polling uses shared settings refresh and retains visibility, nonoverlap and teardown',async()=>{
 const requests:string[][]=[];let finish!:()=>void;const current=jobs(keys=>{requests.push(keys);return new Promise<void>(resolve=>finish=resolve);});
 const cleanup=current.mount();expect(current.intervals).toEqual([10000]);current.tick();current.tick();expect(requests).toEqual([['settings']]);
 finish();await turn();current.document.hidden=true;current.tick();expect(requests).toHaveLength(1);current.document.hidden=false;current.tick();expect(requests).toHaveLength(2);
 cleanup();expect(current.timers.size).toBe(0);finish();await turn();current.tick();expect(requests).toHaveLength(2);
 const preview=jobs(async()=>{throw Error('Preview must not refresh');},true);expect(preview.mount()).toBeUndefined();expect(preview.timers.size).toBe(0);
});

function attribute(source:string,name:string,contains=''){
 let result='';
 function visit(node:any){
  if(!node||typeof node!=='object')return;
  if(node.type==='Attribute'&&node.name===name){
   for(const value of Array.isArray(node.value)?node.value:[node.value])if(value?.expression){const code=source.slice(value.expression.start,value.expression.end);if(code.includes(contains))result=code;}
  }
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
 }
 visit(parse(source,{modern:true}));if(!result)throw Error(`Missing source callback ${name}`);return result;
}
test('actual Music and Games Retry callbacks retain full refresh admission',async()=>{
 for(const component of components.slice(3)){
  const requests:unknown[]=[];await new Function('refreshRouteDependencies','return ('+attribute(component,'retry')+')();')((keys:unknown)=>requests.push(keys));expect(requests).toEqual(['all']);
 }
});
test('actual invitation revoke callback refreshes settings only after its acknowledged command',async()=>{
 const source=attribute(components[1],'onclick','sharing/'),events:unknown[]=[];let release!:()=>void;
 const invoke=new Function('change','refreshRouteDependencies','message',`let busy=false,error='';const link={id:'diagnostic-link'};return {run:${source},get error(){return error;}};`)(
  async(path:string,body:unknown,method:string)=>{events.push({path,body,method});await new Promise<void>(resolve=>release=resolve);},async(keys:string[])=>{events.push(keys);},(error:Error)=>error.message);
 const pending=invoke.run();await invoke.run();expect(events).toEqual([{path:'sharing/diagnostic-link',body:undefined,method:'DELETE'}]);release();await pending;expect(events[1]).toEqual(['settings']);expect(invoke.error).toBe('');
});
