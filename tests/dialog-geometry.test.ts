import { expect, test } from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';
let script=await componentScript('src/lib/ui/components/Dialog.svelte');
const start=script.indexOf('let {'),end=script.indexOf('} = $props();',start);
script=(script.slice(0,start)+"let open=$state(true),popover=true,popoverWidth=560,anchor=initial.anchor,onclose;"+script.slice(end+'} = $props();'.length))
 .replace('let dialog: HTMLElement;','let dialog=element;').replace('$props.id()', '"fixture-dialog"');
const code=compileRunes(`export function create(initial,element,document,window,requestAnimationFrame,cancelAnimationFrame){
 const useClient=()=>({feedback:{host:()=>()=>{}}});const callbacks=[],onDestroy=fn=>callbacks.push(fn),tick=()=>Promise.resolve();
 ${script}
 return {close(){open=false;},reopen(){open=true;},cleanup(){callbacks.forEach(fn=>fn());}};
}`);
const {create}=await import(moduleUrl(code));
function fixture(anchor:string|undefined='#trigger'){
 let reads=0,writes=0,next=0;const frames=new Map<number,FrameRequestCallback>(),listeners=new Map<string,Function>();
 const properties=new Map<string,string>();
 const element={matches:()=>true,hidePopover(){},getBoundingClientRect(){reads++;return {width:240};},style:{setProperty(key:string,value:string){writes++;properties.set(key,value);}}};
 const window={innerHeight:900,innerWidth:1200,addEventListener(type:string,fn:Function){listeners.set(type,fn);},removeEventListener(type:string){listeners.delete(type);}};
 const document={querySelector:()=>({getBoundingClientRect(){reads++;return {bottom:50,right:1000};}})};
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=create({anchor},element,document,window,(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;},(id:number)=>frames.delete(id)));
 runtime.flush();
 return {controller,listeners,frames,properties,window,get reads(){return reads;},get writes(){return writes;},reset(){reads=0;writes=0;},flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(0));},destroy(){controller.cleanup();dispose();}};
}
test('Dialog retains initial/clamped placement and coalesces popover scroll/resize into one placement per frame',()=>{
 const f=fixture();
 try{
  expect(f.reads).toBe(2);expect(f.properties.get('--popover-top')).toBe('58px');expect(f.properties.get('--popover-left')).toBe('760px');
  f.reset();for(let i=0;i<100;i++){f.listeners.get('scroll')!({target:'popover-content'});f.listeners.get('resize')!();}
  expect(f.frames.size).toBe(1);expect(f.reads).toBe(0);f.flush();expect(f.reads).toBe(2);expect(f.writes).toBe(2);
  f.window.innerWidth=300;f.window.innerHeight=200;f.listeners.get('resize')!();f.flush();
  expect(f.properties.get('--popover-top')).toBe('40px');expect(f.properties.get('--popover-left')).toBe('44px');
 }finally{f.destroy();}
 const unanchored=fixture('');
 try{expect(unanchored.properties.get('--popover-top')).toBe('16px');expect(unanchored.properties.get('--popover-left')).toBe('944px');}finally{unanchored.destroy();}
});
test('closing and disposing Dialog cancel scheduled geometry and prevent stale callback publication',()=>{
 const f=fixture();
 try{
  f.listeners.get('scroll')!();const closedCallback=[...f.frames.values()][0];f.controller.close();runtime.flush();
  expect(f.frames.size).toBe(0);expect(f.listeners.size).toBe(0);f.reset();closedCallback(0);expect(f.reads).toBe(0);
  f.controller.reopen();runtime.flush();expect(f.listeners.size).toBe(2);f.listeners.get('resize')!();
  const destroyedCallback=[...f.frames.values()][0];f.destroy();expect(f.frames.size).toBe(0);expect(f.listeners.size).toBe(0);
  f.reset();destroyedCallback(0);expect(f.reads).toBe(0);expect(f.writes).toBe(0);
 }finally{f.destroy();}
});
