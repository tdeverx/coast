import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};export const hooks=[];export const onDestroy=fn=>hooks.push(fn);`);
const lifecycle=await import(lifecycleUrl);
const source=await Bun.file(new URL('../src/lib/ui/action-feedback.svelte.ts',import.meta.url)).text();
const compiled=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'feedback.svelte.js',generate:'client'}).js.code
  .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'))
  .replaceAll('from "svelte"',`from ${JSON.stringify(lifecycleUrl)}`)
  .replaceAll('./client',moduleUrl('export const message=cause=>cause.message;'));
const {createFeedback,actionFeedback}:typeof import('../src/lib/ui/action-feedback.svelte')=await import(moduleUrl(compiled));

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
