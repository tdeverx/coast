import {expect,test} from 'bun:test';
// @ts-expect-error The rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,componentScript} from './fixtures/ui-script';
import {compileModule} from 'svelte/compiler';
import {shelfControls} from '../src/lib/ui/shelves/controls';
const lifecycleUrl=moduleUrl(`export {untrack} from '${import.meta.resolve('svelte')}';export const cleanup=[];export const onDestroy=fn=>cleanup.push(fn);`);
const lifecycle=await import(lifecycleUrl);
const code=compileRunes((await Bun.file(new URL('../src/lib/ui/shelves/continuation.svelte.ts',import.meta.url)).text())
  .replaceAll("from 'svelte'",`from '${lifecycleUrl}'`)
  .replaceAll('#lib/page-window.js',import.meta.resolve('../src/lib/page-window')));
const {createShelfContinuation}:typeof import('../src/lib/ui/shelves/continuation.svelte')=await import(moduleUrl(code));
const cards=(count:number,start=0)=>Array.from({length:count},(_,index)=>index+start);
type Configuration=ReturnType<Parameters<typeof createShelfContinuation<number>>[0]>;
function fixture(overrides:Partial<Configuration>={}){
  const state=runtime.state({items:cards(60),row:true,progressive:true,scope:'first',busy:false,error:'',hasMore:true,page:1,load:async()=>{},...overrides});
  let row!:ReturnType<typeof createShelfContinuation<number>>;
  const dispose=runtime.effect_root(()=>row=createShelfContinuation(()=>runtime.get(state)));
  runtime.flush();
  return {row,set:(patch:Partial<Configuration>)=>{runtime.set(state,{...runtime.get(state),...patch});runtime.flush();},dispose:()=>{dispose();lifecycle.cleanup.splice(0).forEach((fn:()=>void)=>fn());}};
}

test('all rows reveal buffered cards in twenties before reading the next native page',async()=>{
  const calls:{page:number;append:boolean}[]=[];
  const {row,set,dispose}=fixture({load:async(page,append)=>{calls.push({page,append});}});
  try{
    expect(row.items).toEqual(cards(20));expect(calls).toHaveLength(0);
    await row.more();expect(row.items).toEqual(cards(40));expect(calls).toHaveLength(0);
    await row.more();expect(row.items).toEqual(cards(60));expect(calls).toHaveLength(0);
    await row.more();expect(calls).toEqual([{page:2,append:true}]);
    set({items:cards(120),page:2});expect(row.items).toEqual(cards(80));
    await row.more();await row.more();expect(row.items).toEqual(cards(120));expect(calls).toHaveLength(1);
    set({hasMore:false});expect(row.hasMore).toBe(false);await row.more();expect(calls).toHaveLength(1);
  }finally{dispose();}
});

test('concurrent scroll/arrow demand shares one read and a failed append retries the same page',async()=>{
  let finish!:()=>void;const calls:{page:number;append:boolean}[]=[];
  const {row,set,dispose}=fixture({items:cards(20),load:(page,append)=>{calls.push({page,append});return new Promise<void>(resolve=>finish=resolve);}});
  try{
    const first=row.more();for(let index=0;index<100;index++)void row.more();
    expect(calls).toEqual([{page:2,append:true}]);
    set({error:'Temporary'});finish();await first;
    await row.more();expect(calls).toHaveLength(1);expect(row.items).toEqual(cards(20));
    const retry=row.retry();expect(calls[1]).toEqual({page:2,append:true});
    set({error:'',items:cards(40),page:2,hasMore:false});finish();await retry;
    expect(row.items).toEqual(cards(40));expect(row.hasMore).toBe(false);
  }finally{dispose();}
});

test('selection replacement resets the row budget and old completion cannot unlock a new request',async()=>{
  const finishes:(()=>void)[]=[];let calls=0;
  const {row,set,dispose}=fixture({items:cards(20),load:()=>{calls++;return new Promise<void>(resolve=>finishes.push(resolve));}});
  try{
    const old=row.more();set({scope:'second',items:cards(20,100)});
    expect(row.items).toEqual(cards(20,100));
    const current=row.more();expect(calls).toBe(2);
    finishes[0]();await old;await row.more();expect(calls).toBe(2);
    finishes[1]();await current;
    set({items:cards(100),scope:'third'});expect(row.items).toEqual(cards(20));
  }finally{dispose();}
});

test('finite local rows reveal all supplied cards, grids and anchored windows keep their existing presentation',async()=>{
  let calls=0;
  const {row,set,dispose}=fixture({hasMore:false,load:async()=>{calls++;}});
  try{
    expect(row.hasMore).toBe(true);await row.more();await row.more();
    expect(row.items).toEqual(cards(60));expect(row.hasMore).toBe(false);await row.more();expect(calls).toBe(0);
    set({row:false,items:cards(120)});expect(row.items).toHaveLength(120);expect(row.hasMore).toBe(false);
    set({row:true,progressive:false});expect(row.items).toHaveLength(120);
  }finally{dispose();}
});

test('disposal prevents subsequent continuation and retry work',async()=>{
  let calls=0;
  const {row,dispose}=fixture({items:[],load:async()=>{calls++;}});
  dispose();await row.more();await row.retry();expect(calls).toBe(0);
});

test('the actual Shelf script can initialize a cold server render before its lazy source activates',async()=>{
 const serverLifecycle=moduleUrl('export const untrack=fn=>fn();export const onDestroy=()=>{};');
 async function serverModule(path:string){
  const script=await Bun.file(new URL(path,import.meta.url)).text();
  return moduleUrl(compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(script),{generate:'server',filename:'shelf.svelte.js'}).js.code
    .replace(/from ["']svelte["']/g,`from '${serverLifecycle}'`)
    .replaceAll('#lib/page-window.js',import.meta.resolve('../src/lib/page-window')));
 }
 const continuationUrl=await serverModule('../src/lib/ui/shelves/continuation.svelte.ts');
 const selectionUrl=await serverModule('../src/lib/ui/shelves/local.svelte.ts');
 const script=(await componentScript('src/lib/ui/components/Shelf.svelte')).replace('$props.id()',"'fixture'").replace('$props()','input').replace('$bindable(false)','false');
 const fixtureSource=`
  import {createShelfContinuation} from '${continuationUrl}';import {createShelfSelection} from '${selectionUrl}';
  export function render(input,shelfControls){
   const page={data:{},state:{},url:new URL('http://fixture/for-you')};
   const untrack=fn=>fn(),onDestroy=()=>{},useDetailSection=()=>null,useClient=()=>({api:async()=>{},change:async()=>{},preview:true});
   const createShelfSource=()=>undefined,createSequencePlayback=()=>({}),createSocialEnrichment=()=>({cancel(){}}),contentRevisionKey=()=>'',createShelfLayout=()=>({}),reportFailure=()=>{};
   ${script}
   return {cards:displayItems.length,hasMore:displayHasMore};
  }
 `;
 const compiled=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(fixtureSource),{generate:'server',filename:'shelf-script.svelte.js'}).js.code;
 const {render}=await import(moduleUrl(compiled));
 expect(render({items:cards(60).map(id=>({id:String(id),kind:'movie',title:String(id)}))},shelfControls)).toEqual({cards:20,hasMore:true});
});
