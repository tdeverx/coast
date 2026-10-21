// Two actual nested controllers, with isolated DOM/media-query boundaries; not a performance workload.
import {expect} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl} from './ui-script';
const lifecycleUrl=moduleUrl(`
 export let parent;export const contexts=[],cleanups=[],navigations=[];
 export const chooseParent=value=>parent=value;
 export const useRetention=()=>()=>()=>{};
 export const getContext=()=>parent,setContext=(_key,value)=>contexts.push(value);
 export const onMount=fn=>cleanups.push(fn()),afterNavigate=fn=>navigations.push(fn),tick=()=>Promise.resolve();
`);
const lifecycle=await import(lifecycleUrl);
let compact=false,frameId=0,activeObservers=0;
const queries:{listeners:Set<()=>void>;readonly matches:boolean;addEventListener:(type:string,fn:()=>void)=>void;removeEventListener:(type:string,fn:()=>void)=>void}[]=[];
const frames=new Map<number,FrameRequestCallback>(),documentEvents=new Map<string,Set<Function>>(),windowEvents=new Map<string,Set<Function>>();
const listen=(events:Map<string,Set<Function>>,type:string,fn:Function)=>{let set=events.get(type);if(!set)events.set(type,set=new Set());set.add(fn);};
class Node{
 isConnected=true;style={left:'',top:''};opened=false;children:Node[]=[];owner?:Node;onhide?:()=>void;textContent='Item';
 contains(target:Node){return target===this||this.children.includes(target);}
 getBoundingClientRect(){return {top:30,left:40,bottom:60,right:140,width:100,height:30};}
 getClientRects(){return [this.getBoundingClientRect()];}
 closest(){return this.owner;}
 matches(selector:string){return selector===':popover-open'?this.opened:false;}
 querySelectorAll(selector:string){return selector.startsWith('[popover]')?this.children.filter(child=>child.opened):this.children;}
 showPopover(){this.opened=true;}hidePopover(){this.opened=false;this.onhide?.();}
 focus(){document.activeElement=this;}scrollIntoView(){}
}
const document={activeElement:null as Node|null,addEventListener:(type:string,fn:Function)=>listen(documentEvents,type,fn),removeEventListener:(type:string,fn:Function)=>documentEvents.get(type)?.delete(fn)};
const window={innerWidth:1200,innerHeight:900,matchMedia(){
 const query={listeners:new Set<()=>void>(),get matches(){return compact;},addEventListener(_type:string,fn:()=>void){this.listeners.add(fn);},removeEventListener(_type:string,fn:()=>void){this.listeners.delete(fn);}};
 queries.push(query);return query;
},addEventListener:(type:string,fn:Function)=>listen(windowEvents,type,fn),removeEventListener:(type:string,fn:Function)=>windowEvents.get(type)?.delete(fn)};
Object.assign(globalThis,{document,window,Node,Element:Node,HTMLElement:Node,getComputedStyle:()=>({visibility:'visible'}),
 requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:(id:number)=>frames.delete(id),
 ResizeObserver:class{private disconnected=false;constructor(){activeObservers++;}observe(){}disconnect(){if(!this.disconnected){this.disconnected=true;activeObservers--;}}},
});
const source=(await Bun.file('src/lib/ui/controls/menu.svelte.ts').text())
 .replaceAll(/from ['"]svelte['"]/g,`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll(/from ['"]\$app\/navigation['"]/g,`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll(/from ['"]\.\.\/retention['"]/g,`from ${JSON.stringify(lifecycleUrl)}`);
const {createMenuController}=await import(moduleUrl(compileRunes(source)));
const mediaListeners=()=>queries.reduce((sum,query)=>sum+query.listeners.size,0);
const globalListeners=()=>[...documentEvents.values(),...windowEvents.values()].reduce((sum,set)=>sum+set.size,0);
const resize=(value:boolean)=>{compact=value;for(const query of queries)for(const fn of [...query.listeners])fn();runtime.flush();};
function options(){const root=new Node(),surface=new Node(),trigger=new Node();root.children=[surface,trigger];return {root,surface,trigger,config:{root:()=>root,surface:()=>surface,triggerNode:()=>trigger,disabled:()=>false,align:()=>'end' as const,upward:()=>false}};}
const top=options(),nested=options();let parent:any,child:any;
const dispose=runtime.effect_root(()=>{
 parent=createMenuController(top.config);lifecycle.chooseParent(lifecycle.contexts[0]);
 child=createMenuController(nested.config);
});
top.root.children.push(nested.surface);nested.surface.onhide=()=>child.toggle({newState:'closed'});
runtime.flush();expect(mediaListeners()).toBe(0);expect(activeObservers).toBe(0);expect(globalListeners()).toBe(0);
resize(true);expect(parent.compact).toBe(true);expect(child.compact).toBe(true);
parent.openMenu();child.openMenu();runtime.flush();expect(mediaListeners()).toBe(2);expect(parent.childHidden).toBe(true);expect(activeObservers).toBe(2);
child.close(true);await Promise.resolve();runtime.flush();expect(document.activeElement).toBe(nested.trigger);expect(parent.childHidden).toBe(false);expect(mediaListeners()).toBe(1);
resize(false);expect(child.compact).toBe(false);
// Button's actual hover admission checks compact before it calls openMenu.
if(child.nested&&!child.compact)child.openMenu();runtime.flush();expect(child.open).toBe(true);expect(parent.childHidden).toBe(false);expect(mediaListeners()).toBe(2);
resize(true);expect(child.compact).toBe(true);expect(parent.childHidden).toBe(true);
child.triggerKey({key:'Escape',preventDefault(){},stopPropagation(){}});await Promise.resolve();runtime.flush();expect(document.activeElement).toBe(nested.trigger);expect(mediaListeners()).toBe(1);
parent.close();runtime.flush();expect(mediaListeners()).toBe(0);expect(activeObservers).toBe(0);expect(globalListeners()).toBe(0);expect(frames.size).toBe(0);
resize(false);parent.toggle({newState:'open'});runtime.flush();expect(parent.compact).toBe(false);expect(mediaListeners()).toBe(1);
for(const navigate of lifecycle.navigations)navigate({shallow:false,type:'goto'});runtime.flush();expect(mediaListeners()).toBe(0);
for(const cleanup of [...lifecycle.cleanups].reverse())cleanup();dispose();
expect(mediaListeners()+activeObservers+globalListeners()+frames.size).toBe(0);
parent.openMenu();child.openMenu();expect(mediaListeners()).toBe(0);
console.log(JSON.stringify({closedMediaListeners:0,nestedOpenMediaListeners:2,closedModeFresh:true,focusRestored:true,remainingResources:0}));
