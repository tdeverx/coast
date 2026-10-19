import {expect,test} from 'bun:test';
import {compile} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,eraseTypeScript,moduleUrl,resourceUrl} from './fixtures/ui-script';

const paths=['src/routes/+layout.svelte','src/routes/for-you/+page.svelte','src/lib/ui/components/PersistentPlayer.svelte'];
const components=await Promise.all(paths.map(path=>Bun.file(new URL('../'+path,import.meta.url)).text()));
const feedbackPaths=['src/lib/ui/components/Dialog.svelte','src/lib/ui/components/NotificationToasts.svelte'];
const feedbackComponents=await Promise.all(feedbackPaths.map(path=>Bun.file(new URL('../'+path,import.meta.url)).text()));
const rootScript=(await componentScript(paths[0])).split('const watching =')[0].replace('let { data, children } = $props();','');
const feedScript=(await componentScript(paths[1])).replace('let { data } = $props();','');
const playerScript=await componentScript(paths[2]);
const startup=playerScript.slice(playerScript.indexOf('$effect(() => {\n    if (preview) return;\n    const url = src,'),playerScript.indexOf('// Analysis has a shorter lifetime'));
if(!startup.includes('ownsStartup')||!startup.includes('void start().catch'))throw Error('Actual player startup fixture boundary changed');
const playerFeedback=playerScript.slice(playerScript.indexOf('reportFailure(()=>startupImportError'),playerScript.indexOf('reportFailure(()=>trackingNotice'));
const contextSource=await Bun.file(new URL('../src/lib/ui/client-context.ts',import.meta.url)).text();
const importReporter=contextSource.slice(contextSource.indexOf('export function reportImportFailure(')).replace('export ','');
const imports=(source:string)=>eraseTypeScript(source)
 .replace(/import\((['"])([^'"]+)\1\)/g,(_match,_quote,path)=>`transport(${JSON.stringify(path)})`);
const {createRoot,createFeed,createStartup}=await import(moduleUrl(compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function createRoot(initial,transport,inPreview=false){
  let data=$state(initial);const reader=$state({visible:false}),page=$state({state:{},url:new URL('https://example.invalid/library')});
  const cleanups=[],onDestroy=callback=>cleanups.push(callback),feedback=[],reportFailure=(read,retry)=>feedback.push({read,retry});
  let reloads=0;const useClient=()=>({preview:inPreview,feedback:{watch:(read,retry)=>feedback.push({read,retry})}}),window={location:{reload:()=>reloads++}};
  ${imports(importReporter)}
  const replaceState=(_url,state)=>{page.state=state;};
  ${imports(rootScript)}
  return {feedback,get reloads(){return reloads;},get components(){return {Reader,StreamsPanel,MediaDetailPanel,NotificationInbox,FriendsPanel};},
   setReader(value){reader.visible=value;},setState(next){page.state=next;},setData(next){data=next;},dispose(){cleanups.forEach(cleanup=>cleanup());}};
 }
 export function createFeed(initial,transport,inPreview=false){
  let data=$state({hero:null});const page=$state({data:initial,url:new URL('https://example.invalid/for-you')});
  const cleanups=[],onDestroy=callback=>cleanups.push(callback),feedback=[],reportFailure=(read,retry)=>feedback.push({read,retry});
  let reloads=0;const useClient=()=>({preview:inPreview,feedback:{watch:(read,retry)=>feedback.push({read,retry})}}),window={location:{reload:()=>reloads++}};
  ${imports(importReporter)}
  ${imports(feedScript)}
  return {feedback,get reloads(){return reloads;},get component(){return DynamicFeed;},setData(next){page.data=next;},setSection(value){page.url=new URL('https://example.invalid/for-you'+(value?'?section='+value:''));},dispose(){cleanups.forEach(cleanup=>cleanup());}};
 }
 export function createStartup(initial,element,transport,inPreview=false){
  const player=$state({session:initial,paused:false});let preview=inPreview,hls=null,error=$state(''),startupAttempt=$state(0),retryStartup,startupImportError=$state(''),bars;
  const src=$derived(player.session?.url),media=element,noCrop={},partyRoom=null;
  const clearStreamFailure=()=>{},streamInterrupted=()=>{},failure=async()=>{},message=cause=>cause.message;
  let fallbacks=0;const switchEdition=()=>{fallbacks++;},feedback=[],reportFailure=(read,retry)=>feedback.push({read,retry});
  let reloads=0;const useClient=()=>({preview:inPreview,feedback:{watch:(read,retry)=>feedback.push({read,retry})}}),window={location:{reload:()=>reloads++}};
  ${imports(importReporter)}
  ${imports(startup)}
  ${playerFeedback}
  return {feedback,get reloads(){return reloads;},get error(){return error;},get fallbacks(){return fallbacks;},setSession(next){player.session=next;},get session(){return player.session;}};
 }
`,'lazy-import-lifetimes.svelte.js')));

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=async()=>{for(let index=0;index<10;index++)await Promise.resolve();runtime.flush();};
const user=(id='first',role='admin')=>({user:{id,role},capabilities:{social:true,personalisation:true}});
const moduleFor=(name:string)=>({default:Object.assign(()=>{}, {displayName:name})});

test('all changed components compile with their complete client and server templates',()=>{
 const allPaths=[...paths,...feedbackPaths],allComponents=[...components,...feedbackComponents];
 for(let index=0;index<allPaths.length;index++)for(const generate of ['client','server'] as const)
  expect(()=>compile(allComponents[index],{filename:allPaths[index],generate})).not.toThrow();
});

test('both actual feedback hosts display the explicit action label while preserving Undo and Retry',()=>{
 for(const component of feedbackComponents){
  const expression=component.match(/actionLabel=\{([^}]+)\}/u)![1];
  const label=new Function('feedback','return '+expression);
  for(const notice of [{retry:()=>{}},{retry:()=>{},actionLabel:'Reload page'},{undo:()=>{},actionLabel:'Reload page'}])
   expect(label({...notice,current:notice})).toBe(notice.undo?'Undo':notice.actionLabel??'Retry');
 }
});

const failureText=(entry:any)=>{const source=entry.read();return source&&typeof source==='object'?source.text:source;};
const recover=(entry:any)=>{const source=entry.read();return (source&&typeof source==='object'?source.retry:entry.retry)?.();};
const activeFeedback=(controller:any)=>controller.feedback.find((entry:any)=>failureText(entry));

test('all five root import failures offer explicit document reload without repeating failed module imports',async()=>{
 const requests:{path:string;wait:ReturnType<typeof deferred<any>>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createRoot(user(),(path:string)=>{const request={path,wait:deferred<any>()};requests.push(request);return request.wait.promise;}));
 try{runtime.flush();expect(requests).toHaveLength(0);controller.setReader(true);controller.setState({streamsPopover:true,notificationPopover:true,friendsPopover:true,mediaDetailHref:'/media/current'});runtime.flush();
  expect(requests).toHaveLength(5);requests.forEach(request=>request.wait.reject(Error('controlled chunk failure')));await settle();
  expect(controller.feedback.filter((entry:any)=>failureText(entry))).toHaveLength(5);expect(controller.reloads).toBe(0);await settle();expect(requests).toHaveLength(5);
  for(const entry of controller.feedback){expect(failureText(entry)).toContain('Reload the page to try again.');expect(entry.read().actionLabel).toBe('Reload page');recover(entry);}
  expect(controller.reloads).toBe(5);expect(requests).toHaveLength(5);
 }finally{controller.dispose();dispose();}
});

test('successful root imports retain cached components across closing and reopening',async()=>{
 let calls=0,controller:any;
 const dispose=runtime.effect_root(()=>controller=createRoot(user(),async(path:string)=>{calls++;return moduleFor(path);}));
 try{runtime.flush();controller.setReader(true);controller.setState({streamsPopover:true,notificationPopover:true,friendsPopover:true,mediaDetailHref:'/media/current'});runtime.flush();await settle();
  expect(calls).toBe(5);expect(Object.values(controller.components).every(Boolean)).toBe(true);const cached=controller.components;
  controller.setReader(false);controller.setState({});runtime.flush();controller.setReader(true);controller.setState({streamsPopover:true,notificationPopover:true,friendsPopover:true,mediaDetailHref:'/media/current'});runtime.flush();
  expect(calls).toBe(5);expect(controller.components).toEqual(cached);expect(controller.reloads).toBe(0);
 }finally{controller.dispose();dispose();}
});

test('root demand/viewer cleanup fences late imports, errors and reload admission after close or logout',async()=>{
 const requests:{path:string;wait:ReturnType<typeof deferred<any>>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createRoot(user(),(path:string)=>{const request={path,wait:deferred<any>()};requests.push(request);return request.wait.promise;}));
 try{runtime.flush();controller.setReader(true);controller.setState({notificationPopover:true});runtime.flush();expect(requests).toHaveLength(2);
  controller.setReader(false);controller.setState({});runtime.flush();requests[0].wait.resolve(moduleFor('late reader'));requests[1].wait.reject(Error('late notification failure'));await settle();
  expect(controller.components.Reader).toBeUndefined();expect(controller.components.NotificationInbox).toBeUndefined();expect(controller.feedback.every((entry:any)=>!failureText(entry))).toBe(true);
  await Promise.all(controller.feedback.map((entry:any)=>recover(entry)));expect(requests).toHaveLength(2);
  controller.setReader(true);runtime.flush();controller.setData(user('second'));runtime.flush();expect(requests).toHaveLength(4);
  requests[2].wait.reject(Error('old viewer failure'));requests[3].wait.resolve(moduleFor('current reader'));await settle();expect(controller.components.Reader.displayName).toBe('current reader');expect(controller.feedback.every((entry:any)=>!failureText(entry))).toBe(true);
  controller.setState({friendsPopover:true});runtime.flush();controller.setData({user:null,capabilities:{social:false}});runtime.flush();requests[4].wait.reject(Error('signed out'));await settle();expect(controller.feedback.every((entry:any)=>!failureText(entry))).toBe(true);
 }finally{controller.dispose();dispose();}
});

test('disposed root import owners cannot publish or reload',async()=>{
 const wait=deferred<any>();let controller:any,calls=0;
 const dispose=runtime.effect_root(()=>controller=createRoot(user(),()=>{calls++;return wait.promise;}));
 try{runtime.flush();controller.setReader(true);runtime.flush();controller.dispose();wait.resolve(moduleFor('after teardown'));await settle();
  expect(controller.components.Reader).toBeUndefined();await recover(controller.feedback[0]);expect(calls).toBe(1);expect(controller.reloads).toBe(0);
 }finally{controller.dispose();dispose();}
});

test('DynamicFeed import failure offers reload only while its overview remains current',async()=>{
 const requests:ReturnType<typeof deferred<any>>[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createFeed(user(),()=>{const wait=deferred<any>();requests.push(wait);return wait.promise;}));
 try{runtime.flush();expect(requests).toHaveLength(1);requests[0].reject(Error('controlled feed chunk failure'));await settle();expect(failureText(controller.feedback[0])).toContain('Recommendations');expect(requests).toHaveLength(1);expect(controller.reloads).toBe(0);
  recover(controller.feedback[0]);expect(controller.reloads).toBe(1);expect(requests).toHaveLength(1);
  controller.setSection('popular');recover(controller.feedback[0]);expect(controller.reloads).toBe(1);runtime.flush();expect(failureText(controller.feedback[0])).toBe('');
 }finally{controller.dispose();dispose();}
});

test('DynamicFeed section and capability changes fence in-flight delivery and preserve demand',async()=>{
 const requests:ReturnType<typeof deferred<any>>[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createFeed(user(),()=>{const wait=deferred<any>();requests.push(wait);return wait.promise;}));
 try{runtime.flush();controller.setSection('popular');runtime.flush();requests[0].reject(Error('outgoing overview'));await settle();expect(failureText(controller.feedback[0])).toBe('');
  await recover(controller.feedback[0]);expect(requests).toHaveLength(1);controller.setSection(null);runtime.flush();expect(requests).toHaveLength(2);
  controller.setData({...user(),capabilities:{personalisation:false}});runtime.flush();requests[1].resolve(moduleFor('withdrawn'));await settle();expect(controller.component).toBeUndefined();
 }finally{controller.dispose();dispose();}
});

function media(){return {pauses:0,loads:0,plays:0,removed:0,canPlayType:()=>'',pause(){this.pauses++;},load(){this.loads++;},removeAttribute(){this.removed++;},getAttribute:()=>null,play(){this.plays++;return Promise.resolve();}};}
function hlsModule(attachFailure=false){const instances:any[]=[];return {instances,default:class{
 static isSupported=()=>true;static Events={ERROR:'error',FRAG_LOADED:'fragment',MANIFEST_PARSED:'manifest'};static ErrorTypes={MEDIA_ERROR:'media',NETWORK_ERROR:'network'};
 destroyed=0;constructor(){instances.push(this);}loadSource(){}attachMedia(){if(attachFailure)throw Error('controlled attach failure');}on(){}destroy(){this.destroyed++;}
}};}
const session=(id='one',url='https://stream.invalid/one')=>({id,url,kind:'hls'});

test('HLS module rejection offers explicit reload without another import or replacement session',async()=>{
 const waits:ReturnType<typeof deferred<any>>[]=[],element=media();let controller:any;
 const dispose=runtime.effect_root(()=>controller=createStartup(session(),element,()=>{const wait=deferred<any>();waits.push(wait);return wait.promise;}));
 try{runtime.flush();waits[0].reject(Error('controlled HLS chunk failure'));await settle();expect(controller.error).toBe('Playback could not load. Reload the page to try again.');expect(waits).toHaveLength(1);expect(element.pauses).toBe(1);expect(element.loads).toBe(1);
  const notice=activeFeedback(controller);expect(notice.read().actionLabel).toBe('Reload page');expect(controller.reloads).toBe(0);recover(notice);runtime.flush();expect(controller.reloads).toBe(1);expect(waits).toHaveLength(1);
  expect(controller.session.id).toBe('one');expect(controller.fallbacks).toBe(0);
  controller.setSession(null);runtime.flush();recover(notice);expect(controller.reloads).toBe(1);expect(controller.error).toBe('');expect(element.pauses).toBe(1);expect(element.loads).toBe(1);
 }finally{dispose();}
});

test('HLS source replacement and disposal reject late imports without attaching an old engine',async()=>{
 const waits:ReturnType<typeof deferred<any>>[]=[],element=media();let controller:any;
 const dispose=runtime.effect_root(()=>controller=createStartup(session(),element,()=>{const wait=deferred<any>();waits.push(wait);return wait.promise;}));
 runtime.flush();controller.setSession(session('two','https://stream.invalid/two'));runtime.flush();const stale=hlsModule();waits[0].resolve(stale);await settle();expect(stale.instances).toHaveLength(0);
 dispose();const last=hlsModule();waits[1].resolve(last);await settle();expect(last.instances).toHaveLength(0);expect(controller.error).toBe('');expect(element.removed).toBe(2);
});

test('HLS retry destroys a partially attached engine before constructing the recovered engine',async()=>{
 const broken=hlsModule(true),recovered=hlsModule(),element=media();let controller:any,calls=0;
 const dispose=runtime.effect_root(()=>controller=createStartup(session(),element,async()=>++calls===1?broken:recovered));
 try{runtime.flush();await settle();expect(controller.error).toBe('controlled attach failure');expect(broken.instances[0].destroyed).toBe(1);expect(element.pauses).toBe(1);expect(element.loads).toBe(1);
  recover(activeFeedback(controller));runtime.flush();await settle();expect(broken.instances[0].destroyed).toBe(1);expect(recovered.instances).toHaveLength(1);expect(controller.fallbacks).toBe(0);expect(element.pauses).toBe(1);expect(element.loads).toBe(1);
 }finally{dispose();}
 expect(broken.instances[0].destroyed).toBe(1);expect(recovered.instances[0].destroyed).toBe(1);expect(element.pauses).toBe(2);expect(element.loads).toBe(2);
});
