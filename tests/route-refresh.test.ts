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
const client=await read('src/lib/ui/client.ts');
const {create,deferred,turn:runtimeTurn}=await import('./fixtures/navigation-runtime');

/** Use the installed Kit 3 refresh owner with controlled render/load boundaries. */
function navigation(){
 const h=create(kit).value;
 const refreshRouteDependencies=new Function('page','refreshAll','invalidate',functionSource(client,'refreshRouteDependencies')+';return refreshRouteDependencies;')(
  h.page,()=>h.invalidate('refresh'),()=>h.invalidate('invalidate',{resetState:true}));
 return {...h,refreshRouteDependencies};
}

test('shared overlay refresh preserves native shallow state while direct reset remains explicit',async()=>{
 const h=navigation();await h.shallow('initial',{friendsPopover:true});
 await h.refreshRouteDependencies(['settings']);expect(h.page.state.friendsPopover).toBe(true);
 await h.invalidate('reset',{resetState:true});expect(h.page.state.friendsPopover).toBeUndefined();
});

test('a shallow close during pending refresh supersedes its captured state',async()=>{
 const h=navigation();await h.shallow('initial',{friendsPopover:true});
 const gate=deferred<void>();const refresh=h.invalidate('refresh',{gate});await runtimeTurn();
 await h.shallow('initial',{friendsPopover:false});gate.resolve();await refresh;
 expect(h.page.state.friendsPopover).toBe(false);
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
