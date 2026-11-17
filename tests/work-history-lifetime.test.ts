import {expect,test} from 'bun:test';
// @ts-expect-error The existing rune-test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl,resourceUrl} from './fixtures/ui-script';

const menu=moduleUrl(compileRunes((await Bun.file('src/lib/ui/controls/menu-resource.svelte.ts').text()).replaceAll('../resource.svelte',resourceUrl)));
const operation=moduleUrl(compileRunes((await Bun.file('src/lib/ui/operation.svelte.ts').text()).replace("import { message } from './client';","const message=cause=>String(cause);")));
const mutation=moduleUrl(compileRunes((await Bun.file('src/lib/ui/mutation.svelte.ts').text())
 .replace("import { notifyAction } from './action-feedback.svelte';","const notifyAction=()=>{};")
 .replaceAll('./operation.svelte',operation)));
const script=(await componentScript('src/lib/ui/work-menu/WorkHistory.svelte')).replace('open=$bindable(false)','open:initialOpen=false').replace('$props()','properties;let open=$state(initialOpen)');
const {create}=await import(moduleUrl(compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createMenuResource} from ${JSON.stringify(menu)};
 import {createMutation} from ${JSON.stringify(mutation)};
 export function create(transport,write){
  let revision=$state(0);const cleanups=[];
  const properties={target:'work',kind:'music',changed:async()=>{}};
  const onDestroy=callback=>cleanups.push(callback),reportFailure=()=>{},displayLabel=value=>value;
  const workMenuScope=target=>JSON.stringify([target,revision]);
  const useClient=()=>({api:transport,change:write,feedback:{notify(){}}});
  const retryMenuRead=undefined;
  ${script}
  return {show(){open=true;},hide(){open=false;},invalidate(){revision++;},
   choose(){removal={kind,target,entry:{id:'entry',title:'Entry',occurredAt:'2020-01-01'}};},
   remove,busy:()=>mutation.busy,dispose(){cleanups.forEach(callback=>callback());}};
 }
`)));
const settle=async()=>{for(let index=0;index<6;index++){await Promise.resolve();runtime.flush();}};

test('history deletion admits one replacement read and idle external revisions still refresh',async()=>{
 let owner:any,reads=0,cancelled=0,finish!:(value:unknown)=>void;
 const result={items:[],page:1,pages:1,total:0};
 const dispose=runtime.effect_root(()=>owner=create(async(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  reads++;options.signal.addEventListener('abort',()=>{cancelled++;},{once:true});
  if(reads===2)return new Promise(resolve=>{finish=resolve;});
  return result;
 },async()=>{owner.invalidate();runtime.flush();await Promise.resolve();return {removed:true};}));
 try{
  runtime.flush();expect(reads).toBe(0);
  owner.show();runtime.flush();await settle();expect(reads).toBe(1);
  owner.choose();const pending=owner.remove();await settle();
  expect(owner.busy()).toBe(true);expect(reads).toBe(2);expect(cancelled).toBe(0);
  finish(result);await pending;await settle();expect(reads).toBe(2);expect(cancelled).toBe(0);
  owner.invalidate();runtime.flush();await settle();expect(reads).toBe(3);
  owner.hide();runtime.flush();await settle();expect(reads).toBe(3);
 }finally{owner.dispose();dispose();}
});
