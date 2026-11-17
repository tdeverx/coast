import {expect,test} from 'bun:test';
// @ts-expect-error The existing rune-test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl,resourceUrl} from './fixtures/ui-script';
const menu=moduleUrl(compileRunes((await Bun.file('src/lib/ui/controls/menu-resource.svelte.ts').text()).replaceAll('../resource.svelte',resourceUrl)));
const operation=moduleUrl(compileRunes((await Bun.file('src/lib/ui/operation.svelte.ts').text()).replace("import { message } from './client';","const message=cause=>String(cause);")));
const mutation=moduleUrl(compileRunes((await Bun.file('src/lib/ui/mutation.svelte.ts').text()).replace("import { notifyAction } from './action-feedback.svelte';","const notifyAction=()=>{};").replaceAll('./operation.svelte',operation)));
const work=(await Bun.file('src/lib/ui/controls/work.svelte.ts').text()).replace(/^import .*$/gm,'').replace(/^export /gm,'');
const catalogue=(await componentScript('src/lib/ui/work-menu/CatalogueActions.svelte')).replace('$props()','properties').replace(/\bexport (?=(?:async )?function)/g,'');
const quickActions=(await componentScript('src/lib/ui/components/WorkActions.svelte')).replace('$props()','properties').replace(/\bexport (?=(?:async )?function)/g,'');
const settle=async()=>{for(let index=0;index<8;index++){await Promise.resolve();runtime.flush();}};
const result={reasons:[],rating:null,queued:false,game:{platforms:[],playthrough:{id:'run',status:'in-progress',progressPercent:0}},reading:{state:'reading',page:1,totalPages:5}};
async function factory(kind:'reading'|'game'|'music'|'rating'){
 const path=kind==='reading'?'ReadingCommands':kind==='game'?'GameCommands':'MusicCommands';
 const child=(await componentScript(kind==='rating'?'src/lib/ui/components/Rating.svelte':`src/lib/ui/work-menu/${path}.svelte`)).replace('$props()','properties').replace(/\bexport (?=(?:async )?function)/g,'');
 const {create}=await import(moduleUrl(compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createMenuResource} from ${JSON.stringify(menu)};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 import {createMutation} from ${JSON.stringify(mutation)};
 import {createOperation} from ${JSON.stringify(operation)};
 export function create(transport,write,menuFixtureContext){
  let revision=$state(0);const cleanups=[];
  const properties={item:{id:'work',workId:'work',kind:${JSON.stringify(kind==='reading'?'book':kind==='game'?'game':'track')},available:true,title:'Work',href:'#'}};
  const page={data:{user:{id:'user',role:'user',settings:{}},capabilities:{},experiments:{}},url:new URL('https://fixture.invalid'),params:{}};
  const contentRevisionKey=()=>revision,onDestroy=callback=>cleanups.push(callback),reportFailure=()=>{},displayLabel=value=>value;
  const useMenuPreview=()=>menuFixtureContext,menuCondition=(_id,actual)=>actual,detailHref=href=>href,retryMenuRead=undefined;
  const useClient=()=>({api:transport,change:write,preview:!!menuFixtureContext,feedback:{notify(){}}});
  ${work}
  ${catalogue}
  function createChild(properties){${child};return {isBusy,run:${kind==='reading'?'complete':kind==='game'?'finish':kind==='rating'?'()=>rate(4)':'log'}};}
  const message=cause=>cause.message;const command=createChild({workId:'work',mediaId:'work',onrated:value=>work.rate(value),get progress(){return progress;},gameData:{platforms:[],playthrough:{id:'run',status:'in-progress',progressPercent:0}},ensure:work.load,changed});
  ${kind==='rating'?"function createRatingActions(properties){"+quickActions+";ratingControl=command;return {isBusy};}ratingActions=createRatingActions({section:'rating',workId:'work'});":(kind==='reading'?'readingCommands':kind==='game'?'gameCommands':'musicCommands')+'=command;'}
  return {open,close,toggleBackground,background:()=>profileBackground,swapTarget(value){identity.replace({workId:value});},run:()=>command.run(),invalidate(){revision++;},busy:()=>command.isBusy(),dispose(){cleanups.forEach(cleanup=>cleanup());}};
 }
 `)));
 return create;
}
for(const kind of ['reading','game','music'] as const)test(`${kind} child mutation owns one post-write catalogue refresh while external revisions still reload`,async()=>{
 const create=await factory(kind);let owner:any,reads=0,cancelled=0,finish!:(value:unknown)=>void;
 const dispose=runtime.effect_root(()=>owner=create(async(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  reads++;options.signal.addEventListener('abort',()=>cancelled++,{once:true});
  if(reads>=2)return new Promise(resolve=>{finish=resolve;});return result;
 },async()=>{owner.invalidate();runtime.flush();await Promise.resolve();return {}; }));
 try{
  runtime.flush();expect(reads).toBe(0);owner.open();runtime.flush();await settle();expect(reads).toBe(1);
  const pending=owner.run();await settle();expect(owner.busy()).toBe(true);expect(reads).toBe(2);expect(cancelled).toBe(0);
  finish(result);await pending;await settle();expect(reads).toBe(2);
  owner.invalidate();runtime.flush();expect(reads).toBe(3);finish(result);await settle();
  owner.close();owner.invalidate();runtime.flush();expect(reads).toBe(3);
 }finally{owner.dispose();dispose();}
});

test('rating acknowledgement patches do not cancel and restart a post-write catalogue load',async()=>{
 const create=await factory('rating');let owner:any,reads=0,cancelled=0,finish!:(value:unknown)=>void;
 const dispose=runtime.effect_root(()=>owner=create(async(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  reads++;options.signal.addEventListener('abort',()=>cancelled++,{once:true});
  if(reads>=2)return new Promise(resolve=>{finish=resolve;});return result;
 },async()=>{owner.invalidate();runtime.flush();await Promise.resolve();return {}; }));
 try{runtime.flush();expect(reads).toBe(0);owner.open();runtime.flush();await settle();
  await owner.run();await settle();expect(reads).toBe(2);expect(cancelled).toBe(0);finish({...result,rating:4});await settle();
 }finally{owner.dispose();dispose();}
});

const screen=(await componentScript('src/lib/ui/work-menu/ScreenActions.svelte')).replace('$props()','properties').replace(/\bexport (?=(?:async )?function)/g,'');
const rating=(await componentScript('src/lib/ui/components/Rating.svelte')).replace('$props()','properties').replace(/\bexport (?=(?:async )?function)/g,'');
const {create:createScreen}=await import(moduleUrl(compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createMenuResource} from ${JSON.stringify(menu)};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 import {createMutation} from ${JSON.stringify(mutation)};
 export function create(transport,write,menuFixtureContext){
  let revision=$state(0);const cleanups=[];
  const properties={item:{id:'work',kind:'movie',available:true,title:'Movie'}};
  const page={data:{user:{id:'user',role:'user',settings:{}},capabilities:{},experiments:{}},url:new URL('https://fixture.invalid'),params:{}};
  const onDestroy=callback=>cleanups.push(callback),reportFailure=()=>{},getContext=()=>undefined;
  const useMenuPreview=()=>menuFixtureContext,menuCondition=(_id,actual)=>actual,retryMenuRead=undefined;
  const useClient=()=>({api:transport,change:write,preview:!!menuFixtureContext,feedback:{notify(){}}});
  const usePlayback=()=>({player:{loading:false},preview:!!menuFixtureContext}),createSequencePlayback=()=>({error:''}),createRequestControls=()=>({resetOptions(){},cancel(){}});
  const isMediaGroup=()=>false,isResumable=()=>false,message=cause=>cause.message;
  const contentRevisionKey=()=>revision;
  ${work}
  ${screen}
  function createRating(properties){${rating};return {isBusy,run:()=>rate(4)};}
  const command=createRating({mediaId:'work',onrated:value=>snapshot.patch(data=>data?{...data,item:{...data.item,rating:value}}:data)});
  function createRatingActions(properties){${quickActions};ratingControl=command;return {isBusy};}
  ratingActions=createRatingActions({section:'rating',workId:'work'});
  return {open:openMenu,close:closeMenu,toggleBackground,background:()=>profileBackground,swapTarget(id){snapshot.replace({item:{id,kind:'movie',title:'Movie'},editions:[],requests:[],progressTargetIds:[]});},run:command.run,invalidate(){revision++;},dispose(){cleanups.forEach(cleanup=>cleanup());}};
 }
`)));
test('screen rating owns one acknowledged replacement snapshot and leaves closed menus passive',async()=>{
 const value={item:{id:'work',kind:'movie',title:'Movie'},wholeWork:{id:'work',kind:'movie',title:'Movie'},editions:[],requests:[],progressTargetIds:[]};
 let owner:any,reads=0,cancelled=0,finish!:(value:unknown)=>void;
 const dispose=runtime.effect_root(()=>owner=createScreen(async(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  reads++;options.signal.addEventListener('abort',()=>cancelled++,{once:true});if(reads>=2)return new Promise(resolve=>{finish=resolve;});return value;
 },async()=>{owner.invalidate();runtime.flush();await Promise.resolve();return {}; }));
 try{
  runtime.flush();expect(reads).toBe(0);owner.open();runtime.flush();await settle();expect(reads).toBe(1);
  await owner.run();await settle();expect(reads).toBe(2);expect(cancelled).toBe(0);finish({...value,item:{...value.item,rating:4}});await settle();
  owner.invalidate();runtime.flush();expect(reads).toBe(3);finish(value);await settle();owner.close();owner.invalidate();runtime.flush();expect(reads).toBe(3);
 }finally{owner.dispose();dispose();}
});

test('rating replaces a pre-write catalogue snapshot instead of reusing its stale pending read',async()=>{
 const create=await factory('rating');let owner:any,reads=0,cancelled=0;
 const deliveries:((value:unknown)=>void)[]=[];
 const dispose=runtime.effect_root(()=>owner=create(async(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  reads++;options.signal.addEventListener('abort',()=>cancelled++,{once:true});return new Promise(resolve=>deliveries.push(resolve));
 },async()=>{owner.invalidate();runtime.flush();await Promise.resolve();return {}; }));
 try{
  owner.open();runtime.flush();expect(reads).toBe(1);await owner.run();await settle();
  expect(reads).toBe(2);expect(cancelled).toBe(1);
  deliveries[0]({...result,rating:1});deliveries[1]({...result,rating:4});await settle();expect(reads).toBe(2);
 }finally{owner.dispose();dispose();}
});

const previewSource=(await Bun.file('src/lib/ui/controls/menu-preview.ts').text()).replace(/^import .*$/gm,'').replace(/^export /gm,'');
const {create:createPreviewOwner}=await import(moduleUrl(compileRunes(`
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function create(){let context;const cleanups=[];const getContext=()=>context,setContext=(_key,value)=>context=value,onDestroy=callback=>cleanups.push(callback);
 ${previewSource}
 provideMenuPreview({conditions:{},inline:'Actions for ',target:()=>undefined,wrappers:[]});
 return {context:useMenuPreview(),dispose(){cleanups.forEach(cleanup=>cleanup());}};
 }
`)));
test('profile background preview state is isolated, preserves the real fallback and rejects updates after disposal',()=>{
 const first=createPreviewOwner(),second=createPreviewOwner();
 expect(first.context.profileBackground('actual',true)).toBe(true);
 first.context.setProfileBackground('preview');
 expect(first.context.profileBackground('actual',true)).toBe(false);expect(first.context.profileBackground('preview',false)).toBe(true);
 expect(second.context.profileBackground('preview',false)).toBe(false);
 first.context.setProfileBackground(null);expect(first.context.profileBackground('actual',true)).toBe(false);
 first.dispose();first.context.setProfileBackground('late');expect(first.context.profileBackground('late',false)).toBe(false);second.dispose();
});

for(const medium of ['catalogue','screen'] as const)test(`${medium} profile background applies only acknowledged captured IDs and can be cleared without changing the real profile`,async()=>{
 const create=medium==='screen'?createScreen:await factory('rating'),preview=createPreviewOwner();
 let owner:any,finish!:(value:unknown)=>void;const writes:unknown[]=[];
 const dispose=runtime.effect_root(()=>owner=create(async()=>result,async(_path:string,body:unknown)=>{writes.push(body);return new Promise(resolve=>finish=resolve);},preview.context));
 try{
  runtime.flush();owner.toggleBackground();expect(owner.background()).toBe(false);
  owner.swapTarget('other');runtime.flush();finish({});await settle();
  expect(writes[0]).toEqual({action:'background',mediaId:'work'});expect(preview.context.profileBackground('work',false)).toBe(true);expect(owner.background()).toBe(false);
  owner.swapTarget('work');runtime.flush();expect(owner.background()).toBe(true);owner.toggleBackground();expect(owner.background()).toBe(true);
  finish({});await settle();expect(writes[1]).toEqual({action:'background',mediaId:null});expect(owner.background()).toBe(false);
  owner.toggleBackground();preview.dispose();finish({});await settle();expect(preview.context.profileBackground('work',false)).toBe(false);
 }finally{owner.dispose();dispose();preview.dispose();}
});
