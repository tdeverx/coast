import { expect, test } from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';
let script=await componentScript('src/lib/ui/components/Dialog.svelte');
const start=script.indexOf('let {'),end=script.indexOf('} = $props();',start);
script=(script.slice(0,start)+"let open=$state(true),popover=!initial.expanding,popoverWidth=560,anchor=initial.anchor,onclose,contentKey=$state('first'),expanding=!!initial.expanding;"+script.slice(end+'} = $props();'.length))
 .replace('let dialog: HTMLElement;','let dialog=element;').replace('$props.id()', '"fixture-dialog"').replace('let detailScroll=$state<HTMLDivElement>();','let detailScroll=$state.raw(initial.scroll);').replace('let expansionScroll=$state<HTMLDivElement>();','let expansionScroll=$state.raw(initial.expansionScroll);');
const code=compileRunes(`export function create(initial,element,document,window,requestAnimationFrame,cancelAnimationFrame){
 const HTMLElement=class {};const useClient=()=>({feedback:{host:()=>()=>{}}});const callbacks=[],onDestroy=fn=>callbacks.push(fn),tick=()=>Promise.resolve();
 ${script}
 return {nativeClose:closed,get open(){return open;},handoff:handoffScroll,replace(key){contentKey=key;},scroll(top){expansionScroll.scrollTop=top;expandSheet();},scrollPage(top){detailScroll.scrollTop=top;},close(){open=false;},reopen(){open=true;},cleanup(){callbacks.forEach(fn=>fn());}};
}`);
const {create}=await import(moduleUrl(code));
function fixture(anchor:string|undefined='#trigger',expanding=false){
 let reads=0,writes=0,next=0;const frames=new Map<number,FrameRequestCallback>(),listeners=new Map<string,Function>();
 const properties=new Map<string,string>();
 const scroll={scrollTop:0},expansionScroll={scrollTop:0};
 const element={open:false,showModal(){this.open=true;},close(){this.open=false;},contains:()=>false,querySelector:()=>({focus(){}}),matches:()=>true,hidePopover(){},getBoundingClientRect(){reads++;return {width:240};},style:{setProperty(key:string,value:string){writes++;properties.set(key,value);}}};
 const window={innerHeight:900,innerWidth:1200,addEventListener(type:string,fn:Function){listeners.set(type,fn);},removeEventListener(type:string){listeners.delete(type);}};
 const document={querySelector:()=>({getBoundingClientRect(){reads++;return {bottom:50,right:1000};}})};
 let controller:any;
 const dispose=runtime.effect_root(()=>controller=create({anchor,expanding,scroll,expansionScroll},element,document,window,(callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;},(id:number)=>frames.delete(id)));
 runtime.flush();
 return {controller,element,listeners,frames,properties,window,scroll,expansionScroll,get reads(){return reads;},get writes(){return writes;},reset(){reads=0;writes=0;},flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(0));},destroy(){controller.cleanup();dispose();}};
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

test('detail navigation resets content within the retained sheet expansion and a fresh open starts collapsed',()=>{
 const f=fixture(undefined,true);
 try{
  expect(f.properties.get('--detail-expansion')).toBe('0');expect(f.scroll.scrollTop).toBe(0);
  f.controller.scroll(80);f.flush();expect(f.properties.get('--detail-expansion')).toBe('0.5');
  f.controller.replace('partly-expanded');runtime.flush();expect(f.expansionScroll.scrollTop).toBe(80);expect(f.scroll.scrollTop).toBe(0);
  f.controller.scroll(600);f.flush();expect(f.properties.get('--detail-expansion')).toBe('1');
  f.controller.replace('expanded-row-page');runtime.flush();expect(f.expansionScroll.scrollTop).toBe(160);expect(f.scroll.scrollTop).toBe(0);expect(f.properties.get('--detail-expansion')).toBe('1');
  f.controller.scrollPage(450);f.controller.replace('another-expanded-page');runtime.flush();expect(f.expansionScroll.scrollTop).toBe(160);expect(f.scroll.scrollTop).toBe(0);
  f.controller.scroll(0);f.flush();f.controller.replace('collapsed-page');runtime.flush();expect(f.scroll.scrollTop).toBe(0);expect(f.properties.get('--detail-expansion')).toBe('0');
  f.controller.scroll(500);f.flush();f.controller.close();runtime.flush();f.controller.reopen();runtime.flush();
  expect(f.scroll.scrollTop).toBe(0);expect(f.properties.get('--detail-expansion')).toBe('0');
 }finally{f.destroy();}
});

test('detail sheet cannot contract while its content still has upward scroll remaining',()=>{
 const f=fixture(undefined,true);
 try{
  f.controller.scroll(160);f.flush();
  f.controller.scrollPage(400);
  // The browser can keep reverse wheel momentum latched to the outer track.
  for(const top of [140,80,0]){
   f.controller.scroll(top);f.flush();
   expect(f.expansionScroll.scrollTop).toBe(160);
   expect(f.properties.get('--detail-expansion')).toBe('1');
   expect(f.scroll.scrollTop).toBe(400);
  }
  f.controller.scrollPage(0);
  f.controller.scroll(80);f.flush();
  expect(f.properties.get('--detail-expansion')).toBe('0.5');
  f.controller.scroll(0);f.flush();
  expect(f.properties.get('--detail-expansion')).toBe('0');
 }finally{f.destroy();}
});


test('expanded detail hands a latched wheel gesture to content and preserves nested scroll ownership',()=>{
 const f=fixture(undefined,true),listeners=new Map<string,Function>();
 const content=Object.assign(f.scroll,{scrollHeight:1600,clientHeight:400,contains:(target:any)=>target===content||target?.parentElement===content});
 const node=Object.assign(f.expansionScroll,{addEventListener(type:string,fn:Function,options:any){expect(options.passive).toBe(false);listeners.set(type,fn);},removeEventListener(type:string){listeners.delete(type);}});
 Object.assign(f.window,{getComputedStyle:(target:any)=>target.style});
 const action=f.controller.handoff(node);
 const send=(deltaY:number,options:any={})=>{
  let prevented=false;
  listeners.get('wheel')!({target:content,deltaY,deltaX:0,deltaMode:0,cancelable:true,preventDefault(){prevented=true;},...options});
  return prevented;
 };
 try{
  expect(send(80)).toBe(false);expect(content.scrollTop).toBe(0);
  f.controller.scroll(160);f.flush();
  for(let i=0;i<4;i++)expect(send(80)).toBe(true);
  expect(content.scrollTop).toBe(320);
  expect(send(-80)).toBe(true);expect(content.scrollTop).toBe(240);
  for(const options of [{ctrlKey:true},{deltaX:100},{defaultPrevented:true}])expect(send(80,options)).toBe(false);
  expect(content.scrollTop).toBe(240);
  expect(send(80,{cancelable:false})).toBe(false);expect(content.scrollTop).toBe(320);
  expect(send(-80,{cancelable:false})).toBe(false);expect(content.scrollTop).toBe(240);
  f.controller.scroll(110);
  expect(send(-80,{cancelable:false})).toBe(false);expect(content.scrollTop).toBe(160);
  f.flush();expect(node.scrollTop).toBe(160);expect(f.properties.get('--detail-expansion')).toBe('1');
  content.scrollTop=240;
  const nested={scrollHeight:600,clientHeight:100,scrollTop:0,parentElement:content,style:{overflowY:'auto',overscrollBehaviorY:'auto'}};
  expect(send(80,{target:nested})).toBe(false);expect(content.scrollTop).toBe(240);
  nested.scrollTop=500;
  expect(send(80,{target:nested})).toBe(true);expect(content.scrollTop).toBe(320);
  nested.style.overscrollBehaviorY='contain';expect(send(80,{target:nested})).toBe(false);
  expect(send(2,{deltaMode:1})).toBe(true);expect(content.scrollTop).toBe(360);
  expect(send(1,{deltaMode:2})).toBe(true);expect(content.scrollTop).toBe(760);
  expect(send(999)).toBe(true);expect(content.scrollTop).toBe(1200);expect(send(80)).toBe(false);
  expect(send(-9999)).toBe(true);expect(content.scrollTop).toBe(0);
  expect(send(-80)).toBe(true);expect(node.scrollTop).toBe(80);
  expect(send(-100)).toBe(true);expect(node.scrollTop).toBe(0);
  expect(send(-80)).toBe(false);
  f.controller.close();runtime.flush();expect(send(80)).toBe(false);
 }finally{action.destroy();expect(listeners.size).toBe(0);f.destroy();}
});

test('a queued native close event cannot dismiss a newly reopened dialog',()=>{
 const f=fixture(undefined,true);
 try{
  f.controller.close();runtime.flush();expect(f.element.open).toBe(false);
  f.controller.reopen();runtime.flush();expect(f.element.open).toBe(true);
  f.controller.nativeClose();runtime.flush();expect(f.controller.open).toBe(true);expect(f.element.open).toBe(true);
  f.element.close();f.controller.nativeClose();runtime.flush();expect(f.controller.open).toBe(false);
 }finally{f.destroy();}
});
