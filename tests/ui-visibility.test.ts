import {expect,test} from 'bun:test';

// Supplementary observer/lifetime controls; real-card browser acceptance is recorded separately.
async function environment(run:(api:typeof import('../src/lib/ui/visibility'),state:any)=>void) {
 const source=await Bun.file(new URL('../src/lib/ui/visibility.ts',import.meta.url)).text();
 const code=new Bun.Transpiler({loader:'ts'}).transformSync(source);
 const prior=new Map(['document','IntersectionObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const state:any={listeners:new Set<()=>void>(),observed:new Set(),unobserved:[],disconnects:0};
 const document={visibilityState:'visible',addEventListener:(_name:string,fn:()=>void)=>state.listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>state.listeners.delete(fn)};
 class Observer {
  constructor(callback:Function,options:unknown){state.deliver=callback;state.options=options;}
  observe(node:unknown){state.observed.add(node);}
  unobserve(node:unknown){state.unobserved.push(node);state.observed.delete(node);}
  disconnect(){state.disconnects++;state.observed.clear();}
 }
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 Object.defineProperty(globalThis,'IntersectionObserver',{configurable:true,writable:true,value:Observer});
 state.hide=(hidden:boolean)=>{document.visibilityState=hidden?'hidden':'visible';for(const fn of state.listeners)fn();};
 try{
  const api=await import(`data:text/javascript;base64,${Buffer.from(code+'\n//'+crypto.randomUUID()).toString('base64')}`);
  run(api,state);
 }finally{
  for(const[key,value]of prior)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);
 }
}
test('shared card visibility tracks demand, pauses hidden documents and releases the last owner',async()=>{
 await environment(({observeVisibility},state)=>{
  const first={}as HTMLElement,second={}as HTMLElement,a:boolean[]=[],b:boolean[]=[];
  const stopA=observeVisibility(first,value=>a.push(value)),stopB=observeVisibility(second,value=>b.push(value));
  expect(state.options).toEqual({rootMargin:'300px 0px'});expect(state.listeners.size).toBe(1);
  state.deliver([{target:first,isIntersecting:true},{target:second,isIntersecting:false}]);
  expect(a.at(-1)).toBe(true);expect(b.at(-1)).toBe(false);
  state.hide(true);expect(a.at(-1)).toBe(false);expect(b.at(-1)).toBe(false);
  state.hide(false);expect(a.at(-1)).toBe(true);expect(b.at(-1)).toBe(false);
  stopA();expect(state.listeners.size).toBe(1);stopB();expect(state.listeners.size).toBe(0);expect(state.disconnects).toBe(1);
  const before=[a.length,b.length];state.deliver([{target:first,isIntersecting:true},{target:second,isIntersecting:true}]);expect([a.length,b.length]).toEqual(before);
 });
});
test('obsolete card cleanup cannot unregister a replacement on the same native element',async()=>{
 await environment(({observeVisibility},state)=>{
  const node={}as HTMLElement,old:boolean[]=[],current:boolean[]=[];
  const releaseOld=observeVisibility(node,value=>old.push(value));state.deliver([{target:node,isIntersecting:true}]);
  const releaseCurrent=observeVisibility(node,value=>current.push(value));expect(current).toEqual([true]);
  releaseOld();expect(state.observed.has(node)).toBe(true);expect(state.unobserved).toEqual([]);
  state.deliver([{target:node,isIntersecting:false}]);expect(current.at(-1)).toBe(false);expect(old).toEqual([false,true]);
  releaseCurrent();expect(state.listeners.size).toBe(0);expect(state.disconnects).toBe(1);
 });
});
test('missing observer support retains hidden-document admission and cleanup',async()=>{
 await environment(({observeVisibility},state)=>{
  Object.defineProperty(globalThis,'IntersectionObserver',{configurable:true,value:undefined});state.hide(true);
  const values:boolean[]=[],release=observeVisibility({}as HTMLElement,value=>values.push(value));
  expect(values).toEqual([false]);state.hide(false);expect(values).toEqual([false,true]);release();expect(state.listeners.size).toBe(0);
 });
});
