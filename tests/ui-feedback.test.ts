import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
import {createRawSnippet} from 'svelte';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};export const hooks=[];export const onDestroy=fn=>hooks.push(fn);`);
const lifecycle=await import(lifecycleUrl);
const pageUrl=moduleUrl(`import {state,get,set} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 const user=state(undefined);
 export const page={data:{get user(){return get(user);}}};
 export const setViewer=id=>set(user,id ? {id} : undefined);`);
const {setViewer}=await import(pageUrl);
const clientUrl=moduleUrl('export const message=cause=>cause.message;export const coastConnectionMessage="Connection lost";export const api=async()=>{};export const change=api,changeMany=api,createApiClient=()=>{};export const refreshAfterChange=async()=>{};');
const source=await Bun.file(new URL('../src/lib/ui/action-feedback.svelte.ts',import.meta.url)).text();
const compiled=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'feedback.svelte.js',generate:'client'}).js.code
  .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'))
  .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`)
  .replaceAll('$app/state',pageUrl)
  .replaceAll('./controls/feedback-notifications',import.meta.resolve('../src/lib/ui/controls/feedback-notifications'))
  .replaceAll('./client',clientUrl);
const feedbackUrl=moduleUrl(compiled);
const {createFeedback,actionFeedback}:typeof import('../src/lib/ui/action-feedback.svelte')=await import(feedbackUrl);

test('isolated feedback, modal ownership and failed retries stay in their owning delivery scope',async()=>{
 const preview=createFeedback();
 preview.failure('Unavailable',async()=>{throw new Error('Still unavailable');});
 expect(actionFeedback.current).toBeNull();
 const closeFirst=preview.host('first'),closeSecond=preview.host('second');
 expect(preview.activeHost).toBe('second');
 closeFirst();expect(preview.activeHost).toBe('second');
 await preview.act();expect(preview.current?.error).toBe('Still unavailable');expect(preview.current?.busy).toBe(false);
 closeSecond();expect(preview.activeHost).toBeNull();
 preview.notify('Saved');expect(actionFeedback.current).toBeNull();
});
test('a failure is announced once, releases its retry on destruction, and does not dismiss another operation',async()=>{
 const feedback=createFeedback(),error=runtime.state('Unavailable');
 let retries=0;
 const dispose=runtime.effect_root(()=>feedback.watch(()=>runtime.get(error),async()=>{retries++;runtime.set(error,'');runtime.flush();}));
 try {
  runtime.flush();const first=feedback.current;
  runtime.flush();expect(feedback.current).toBe(first);
  feedback.clear();runtime.flush();expect(feedback.current).toBeNull();
  // Dismissal survives unrelated renders; a new attempt can announce it again.
  runtime.set(error,'');runtime.flush();runtime.set(error,'Unavailable');runtime.flush();
  expect(feedback.current?.text).toBe('Unavailable');
  await feedback.act();expect(retries).toBe(1);expect(feedback.current).toBeNull();
  runtime.set(error,'Unavailable');runtime.flush();expect(feedback.current?.text).toBe('Unavailable');
  feedback.notify('Another operation succeeded.');
  runtime.set(error,'');runtime.flush();expect(feedback.current?.text).toBe('Another operation succeeded.');
 } finally {dispose();for(const hook of lifecycle.hooks.splice(0))hook();}
});
test('a watched retry retains an unchanged failure until its source clears',async()=>{
 const feedback=createFeedback(),error=runtime.state('Unavailable');
 let finish!:()=>void;
 const dispose=runtime.effect_root(()=>feedback.watch(()=>runtime.get(error),()=>new Promise<void>(resolve=>{finish=resolve;})));
 try {
  runtime.flush();
  const pending=feedback.act();expect(feedback.current?.busy).toBe(true);
  finish();await pending;
  expect(feedback.current?.text).toBe('Unavailable');expect(feedback.current?.busy).toBe(false);
  runtime.set(error,'');runtime.flush();expect(feedback.current).toBeNull();
 } finally {dispose();for(const hook of lifecycle.hooks.splice(0))hook();}
});
test('closing an operation removes its scoped failure and releases the retry callback',()=>{
 const feedback=createFeedback(),open=runtime.state(true);
 const dispose=runtime.effect_root(()=>feedback.watch(()=>runtime.get(open)?{text:'Unavailable',retry:()=>{}}:''));
 try {
  runtime.flush();expect(feedback.current?.retry).toBeFunction();
  runtime.set(open,false);runtime.flush();expect(feedback.current).toBeNull();
  runtime.set(open,true);runtime.flush();expect(feedback.current?.text).toBe('Unavailable');
  feedback.notify('Unrelated action');runtime.set(open,false);runtime.flush();
  expect(feedback.current?.text).toBe('Unrelated action');
 } finally {dispose();for(const hook of lifecycle.hooks.splice(0))hook();}
});
test('overlapping failures restore the remaining operation and its latest retry',async()=>{
 const feedback=createFeedback(),first=runtime.state('First failure'),second=runtime.state('');
 const attempt=runtime.state(1);let retried=0;
 const dispose=runtime.effect_root(()=>{
  feedback.watch(()=>{const value=runtime.get(attempt);return {text:runtime.get(first),retry:()=>{retried=value;}};});
  feedback.watch(()=>runtime.get(second));
 });
 try {
  runtime.flush();const original=feedback.current;
  runtime.set(second,'Second failure');runtime.flush();expect(feedback.current?.text).toBe('Second failure');
  runtime.set(attempt,2);runtime.flush();expect(feedback.current?.text).toBe('Second failure');
  runtime.set(second,'');runtime.flush();expect(feedback.current).toBe(original);
  await feedback.act();expect(retried).toBe(2);
  runtime.set(second,'Second failure');runtime.flush();runtime.set(first,'');runtime.flush();
  expect(feedback.current?.text).toBe('Second failure');
  runtime.set(second,'');runtime.flush();expect(feedback.current).toBeNull();
 } finally {dispose();for(const hook of lifecycle.hooks.splice(0))hook();}
});

test('watched action labels update with an unchanged failure and retain Retry and Undo defaults',()=>{
 const feedback=createFeedback(),label=runtime.state<string|undefined>('Reload page');
 const dispose=runtime.effect_root(()=>feedback.watch(()=>({text:'Unavailable',retry:()=>{},actionLabel:runtime.get(label)})));
 try{
  runtime.flush();const notice=feedback.current;expect(notice?.actionLabel).toBe('Reload page');
  runtime.set(label,undefined);runtime.flush();expect(feedback.current).toBe(notice);expect(notice?.actionLabel).toBeUndefined();
  feedback.notify('Saved',async()=>{});expect(feedback.current?.undo).toBeFunction();expect(feedback.current?.actionLabel).toBeUndefined();
 }finally{dispose();for(const hook of lifecycle.hooks.splice(0))hook();}
});

const contextSource=await Bun.file(new URL('../src/lib/ui/client-context.ts',import.meta.url)).text();
const {useClient,reportFailure}:typeof import('../src/lib/ui/client-context')=await import(moduleUrl(
 new Bun.Transpiler({loader:'ts'}).transformSync(contextSource)
  .replaceAll('./action-feedback.svelte',feedbackUrl)
  .replaceAll('./client',clientUrl)
  .replace(/(['"])svelte\1/g,JSON.stringify(moduleUrl('export const getContext=()=>undefined,setContext=()=>{};'))),
));
const reporter=contextSource.slice(contextSource.indexOf('export function reportImportFailure(')).replace('export ','');
function importReporter(feedback:ReturnType<typeof createFeedback>,preview=false){
 let reloads=0;
 const report=new Function('useClient','window',new Bun.Transpiler({loader:'ts'}).transformSync(reporter)+';return reportImportFailure;')(
  ()=>({feedback,preview}),{location:{reload:()=>reloads++}});
 return {report,get reloads(){return reloads;}};
}

test('module recovery reloads only on explicit action while the current error remains and never in preview',async()=>{
 for(const preview of [false,true]){
  const feedback=createFeedback(),error=runtime.state('Reload the page to try again.'),owner=importReporter(feedback,preview);
  const dispose=runtime.effect_root(()=>owner.report(()=>runtime.get(error)));
  try{
   runtime.flush();expect(owner.reloads).toBe(0);expect(feedback.current?.actionLabel).toBe('Reload page');
   await feedback.act();expect(owner.reloads).toBe(preview?0:1);expect(feedback.current?.text).toBe('Reload the page to try again.');
   // A close/supersession may precede the next render; the old visible action must recheck demand.
   runtime.set(error,'');await feedback.act();expect(owner.reloads).toBe(preview?0:1);runtime.flush();expect(feedback.current).toBeNull();
   runtime.set(error,'Reload the page to try again.');runtime.flush();expect(feedback.current?.retry).toBeFunction();
  }finally{dispose();for(const hook of lifecycle.hooks.splice(0))hook();}
  expect(feedback.current).toBeNull();await feedback.act();expect(owner.reloads).toBe(preview?0:1);
 }
});

test('owned pending feedback stays busy, becomes retryable, and restores unrelated feedback on completion',async()=>{
 const feedback=createFeedback(),owner=Symbol('final playback save');let attempts=0;
 feedback.notify('Unrelated message');feedback.pending('Saving playback progress…',owner);
 expect(feedback.current?.kind).toBe('info');expect(feedback.current?.busy).toBe(true);
 feedback.failure('Save failed',()=>{attempts++;feedback.clear(owner);},owner);
 expect(feedback.current?.busy).toBe(false);await feedback.act();expect(attempts).toBe(1);expect(feedback.current?.text).toBe('Unrelated message');
});

test('notify, pending, failure and undo records survive X and dialog host transfers without duplicate publication',async()=>{
 const records:{id:string;text:string;kind:string;pending:boolean}[]=[];
 const feedback=createFeedback(notice=>records.push(notice)),owner=Symbol('operation');
 feedback.notify('Saved',async()=>{});feedback.clear();expect(records).toHaveLength(1);
 feedback.pending('Saving',owner);const pending=records[1];
 feedback.failure('Failed',undefined,owner);expect(records[2]).toMatchObject({id:pending.id,kind:'error',pending:false});
 const close=feedback.host('dialog');feedback.showNotifications(createRawSnippet(()=>({render:()=>'<span>Notifications</span>'})));close();expect(records).toHaveLength(3);
 feedback.clearAll();expect(records).toHaveLength(3);
 feedback.recordingFailure(async()=>false,owner);expect(records).toHaveLength(3);
 feedback.notify('Saved again',async()=>{});await feedback.act();expect(records.at(-1)?.text).toBe('Change undone.');
});
test('late retry errors cannot record an old viewers feedback under a new account',async()=>{
 let viewer='one',reject!:(cause:unknown)=>void;const records:{text:string;viewer?:string}[]=[];
 const feedback=createFeedback((notice,viewer)=>records.push({text:notice.text,viewer}),()=>viewer);
 feedback.failure('Old account failure',()=>new Promise((_resolve,no)=>{reject=no;}));
 const pending=feedback.act();viewer='two';reject(Error('Old retry detail'));await pending;
 expect(records).toEqual([{text:'Old account failure',viewer:'one'}]);
});

test('a persistent error watcher can publish after sign-in without replaying its previous viewer’s error',()=>{
 const error=runtime.state('Anonymous failure');
 const anonymous=useClient().feedback;
 const dispose=runtime.effect_root(()=>reportFailure(()=>runtime.get(error),undefined,'current-viewer'));
 try {
  runtime.flush();expect(anonymous.current?.text).toBe('Anonymous failure');
  setViewer('signed-in');runtime.flush();expect(actionFeedback.current).toBeNull();
  anonymous.failure('Late anonymous operation');expect(actionFeedback.current).toBeNull();
  runtime.set(error,'New playback failure');runtime.flush();
  expect(actionFeedback.current?.text).toBe('New playback failure');
  expect(actionFeedback.current?.viewerId).toBe('signed-in');
 } finally {
  dispose();for(const hook of lifecycle.hooks.splice(0))hook();
  anonymous.clearAll();actionFeedback.clearAll();setViewer(undefined);
 }
});

test('departing host cleanup drops the old undo and leaves the incoming viewer’s notice intact',async()=>{
 setViewer('first');const departing=useClient().feedback;
 let undoCount=0;
 try {
  departing.notify('Saved by the first viewer',async()=>{undoCount++;});
  setViewer('second');const arriving=useClient().feedback;
  expect(arriving.current).toBeNull();await arriving.act();expect(undoCount).toBe(0);
  arriving.notify('Saved by the second viewer');departing.clearAll();
  expect(arriving.current?.text).toBe('Saved by the second viewer');
  arriving.clearAll();setViewer('first');expect(departing.current).toBeNull();
 } finally {departing.clearAll();actionFeedback.clearAll();setViewer(undefined);}
});
