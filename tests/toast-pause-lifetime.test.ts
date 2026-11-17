import {expect,test} from 'bun:test';
// @ts-expect-error The existing rune-test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';
const script=(await componentScript('src/lib/ui/components/Toast.svelte')).replace('$props()','properties');
const {create}=await import(moduleUrl(compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 export function create(){
  let log=$state([]),calls=0;
  const properties={text:'Pause fixture',onpause:value=>{calls++;if(calls>6)return;log=[...log,value];}};
  const onMount=()=>{},notificationToastDuration=7000,cardArtwork=()=>({candidates:[]});
  ${script}
  return {focus(value){focused=value;},hover(value){hovered=value;},note(){log=[...log,'external'];},get log(){return log;},get calls(){return calls;}};
 }
`)));
const settle=async()=>{for(let index=0;index<6;index++){await Promise.resolve();runtime.flush();}};
test('toast pause callbacks can update their own reactive log without subscribing or repeating',async()=>{
 let owner:any;const dispose=runtime.effect_root(()=>owner=create());
 try{
  runtime.flush();expect(owner.calls).toBe(0);owner.focus(true);await settle();
  expect(owner.calls).toBe(1);expect(owner.log).toEqual([true]);
  owner.note();await settle();expect(owner.calls).toBe(1);expect(owner.log).toEqual([true,'external']);
  owner.hover(true);owner.focus(false);await settle();expect(owner.calls).toBe(1);
  owner.hover(false);await settle();expect(owner.calls).toBe(2);expect(owner.log).toEqual([true,'external',false]);
 }finally{dispose();}
});
