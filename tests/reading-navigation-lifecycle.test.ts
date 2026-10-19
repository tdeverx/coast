import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';

const script=(await componentScript('src/lib/reading/Reader.svelte'))
 .replace('let host=$state<HTMLElement>();', 'let host=$state<HTMLElement>(fixtureHost);')
 .replace("import('./reader/engine')",'Promise.resolve({createReader})')
 .replace('$props()', '({example:previewExample})');
const code=compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {sameReadingLocation} from ${JSON.stringify(import.meta.resolve('../src/lib/reading/model'))};
 export function create(createReader,control=true,previewMode=false,previewExample=undefined){
  const applicationReader=$state({session:{id:'first',url:'fixture.pdf',format:'pdf',location:null,workId:'work',edition:'edition'},file:null,visible:true,rendering:false,location:null,error:''});
  const reportFailure=()=>{},useClient=()=>({preview:previewMode}),calls=[];
  const page={data:{user:{settings:{}}}};
  const syncedPlayer={room:{mediaType:'reading',mediaId:'work',edition:'edition',readingFormat:'pdf',reading:{format:'pdf',page:1,total:2}}};
  const canControlPlayback=()=>control,fixtureHost={},message=error=>error.message;
  let exit=null,navigator=null;const api=async()=>{calls.push('api');},recordReading=async()=>{calls.push('record');return true;},publishReading=()=>{calls.push('publish');},setReadingNavigator=value=>{navigator=value;calls.push('navigator');},setReadingExit=value=>{exit=value},closeReading=async()=>{calls.push('close');},retryReadingSave=async()=>{calls.push('retry');};
  ${script}
  return {turn,calls,exit:()=>exit?.(),navigate:location=>navigator?.(location),openPreview(){sample.visible=true;},closePreview:close,get previewVisible(){return sample.visible;},get location(){return reader.location;},get live(){return applicationReader;},replace(){applicationReader.session={...applicationReader.session,id:'replacement'};},hide(){applicationReader.visible=false;},show(){applicationReader.visible=true;},get busy(){return busy;},get external(){return external;},get error(){return reader.error;},get loadProgress(){return loadProgress;},get loading(){return loading;}};
 }`);
const {create}=await import(moduleUrl(code));
const deferred=()=>{let resolve!:()=>void,reject!:(cause:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<12;i++){runtime.flush();await Promise.resolve();}};

test('replaced or minimized Reader turns cannot publish late failures or clear a new turn busy state',async()=>{
 for(const transition of ['replace','hide'] as const){
  const old=deferred(),next=deferred();let calls=0,owner:any;
  const dispose=runtime.effect_root(()=>owner=create(async()=>({next:()=>++calls===1?old.promise:next.promise,destroy(){}})));
  try{
   await settle();const first=owner.turn('next');expect(owner.busy).toBe(true);
   owner[transition]();await settle();expect(owner.busy).toBe(false);
   if(transition==='hide'){owner.show();await settle();}
   const second=owner.turn('next');expect(owner.busy).toBe(true);
   old.reject(Error('Old worker was destroyed'));await first;await settle();
   expect(owner.error).toBe('');expect(owner.busy).toBe(true);
   next.resolve();await second;expect(owner.busy).toBe(false);
  }finally{old.resolve();next.resolve();dispose();}
 }
});

test('a location received during startup takes precedence over the captured bookmark',async()=>{
 const opening=deferred(),targets:any[]=[];let owner:any,created=0;
 const dispose=runtime.effect_root(()=>owner=create(async()=>{created++;await opening.promise;return {go:async(location:any)=>{targets.push(location);},destroy(){}};}));
 try{
  await settle();owner.live.location={format:'pdf',page:2,total:2};await settle();
  expect(created).toBe(1);opening.resolve();await settle();
  expect(targets).toEqual([{format:'pdf',page:2,total:2}]);
  expect(owner.location).toEqual({format:'pdf',page:2,total:2});
  expect(owner.external).toBe(false);
 }finally{opening.resolve();dispose();}
});

test('late follower rollback completion cannot overwrite a replacement Reader navigation owner',async()=>{
 const old=deferred(),next=deferred(),options:any[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>owner=create(async(input:any)=>{const pending=options.length?next:old;options.push(input);return {go:()=>pending.promise,destroy(){}};},false));
 try{
  await settle();options[0].changed({format:'pdf',page:2,total:2});expect(owner.external).toBe(true);
  owner.replace();await settle();expect(owner.external).toBe(false);
  options[1].changed({format:'pdf',page:2,total:2});expect(owner.external).toBe(true);
  old.reject(Error('Old follower worker was destroyed'));await settle();
  expect(owner.error).toBe('');expect(owner.external).toBe(true);
  next.resolve();await settle();expect(owner.external).toBe(false);
 }finally{old.resolve();next.resolve();dispose();}
});


test('preview Reader shell never starts an engine or mutates live reader/bookmark/party owners',async()=>{
 let created=0,owner:any;
 const dispose=runtime.effect_root(()=>owner=create(async()=>{created++;throw Error('Preview must not create an engine');},true,true,{title:'Preview book',state:'ready'}));
 try{
  await settle();owner.openPreview();await settle();await owner.turn('next');await settle();
  expect(owner.location).toEqual({format:'cbz',page:2,total:8});expect(owner.previewVisible).toBe(true);
  owner.closePreview();await settle();expect(owner.previewVisible).toBe(false);
  expect(created).toBe(0);expect(owner.calls).toEqual([]);expect(owner.live.session.id).toBe('first');expect(owner.live.location).toBe(null);expect(owner.live.visible).toBe(true);
 }finally{dispose();}
 expect(owner.calls).toEqual([]);
});
test('loading progress belongs to the current reader and resets on resume',async()=>{
 const pending=deferred(),options:any[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>owner=create(async(input:any)=>{options.push(input);await pending.promise;return {destroy(){}};}));
 try{
  await settle();expect(options[0].sanitizeOddPages).toBe(true);
  options[0].progress({phase:'download',loaded:10,total:20});
  expect(owner.loadProgress).toEqual({phase:'download',loaded:10,total:20});
  owner.hide();await settle();owner.show();await settle();
  expect(owner.loadProgress).toEqual({phase:'prepare'});
  options[0].progress({phase:'download',loaded:20,total:20});
  expect(owner.loadProgress).toEqual({phase:'prepare'});
  options[1].progress({phase:'render'});expect(owner.loadProgress.phase).toBe('render');
 }finally{pending.resolve();await settle();dispose();}
});

const operationUrl=moduleUrl(compileRunes((await Bun.file('src/lib/ui/operation.svelte.ts').text()).replace("import { message } from './client';",'const message=cause=>cause.message;')));
const launchScript=(await componentScript('src/lib/reading/ReadingLaunch.svelte')).replace('$props()', '({get workId(){return props.id;},onopened:opened})').replace('const id=workId','const id=props.id').replace('export async function show', 'async function show').replace('export function isBusy','function isBusy');
const launchCode=compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {createOperation} from ${JSON.stringify(operationUrl)};
 export function create(openFile,previewMode=false,session=null){
  let dispose=()=>{},completed=0;
  const props=$state({id:'work'}),onDestroy=callback=>{dispose=callback;},opened=async()=>{completed++;};
  const reader=$state({session,visible:false});
  const reportFailure=()=>{},useClient=()=>({preview:previewMode}),openReading=openFile;
  ${launchScript}
  return {show,isBusy,dispose:()=>dispose(),get completed(){return completed;},get visible(){return reader.visible;},replace(){props.id='replacement';}};
 }`);
const {create:createLaunch}=await import(moduleUrl(launchCode));
test('Read goes directly to shared preparation with no connection, search or edition-picker reads',async()=>{
 const calls:any[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>owner=createLaunch(async(...args:any[])=>calls.push(args)));
 try{await owner.show();expect(calls).toHaveLength(1);expect(calls[0][0]).toBe('work');expect(calls[0][1]).toBeUndefined();expect(calls[0][2]).toBeInstanceOf(AbortSignal);expect(owner.completed).toBe(1);}
 finally{owner.dispose();dispose();}
});
test('preview Read does no file/session work and cannot resume the live reader',async()=>{
 let calls=0,owner:any;
 const dispose=runtime.effect_root(()=>owner=createLaunch(async()=>{calls++;},true,{workId:'work'}));
 try{await owner.show();expect(calls).toBe(0);expect(owner.visible).toBe(false);expect(owner.completed).toBe(0);}
 finally{owner.dispose();dispose();}
});
test('Read resumes its current session without preparing another edition',async()=>{
 let calls=0,owner:any;
 const dispose=runtime.effect_root(()=>owner=createLaunch(async()=>{calls++;},false,{workId:'work'}));
 try{await owner.show();expect(calls).toBe(0);expect(owner.visible).toBe(true);expect(owner.completed).toBe(1);}
 finally{owner.dispose();dispose();}
});
test('duplicate Read is coalesced; disposal or a changed target cancels the preparation owner',async()=>{
 for(const transition of ['dispose','replace']as const){
  const late=deferred();let signal:AbortSignal|undefined,starts=0,owner:any;
  const dispose=runtime.effect_root(()=>owner=createLaunch(async(_id:string,_source:unknown,current:AbortSignal)=>{starts++;signal=current;await late.promise;}));
  try{const pending=owner.show();await owner.show();expect(starts).toBe(1);expect(owner.isBusy()).toBe(true);owner[transition]();await settle();expect(signal?.aborted).toBe(true);late.resolve();await pending;expect(owner.completed).toBe(0);expect(owner.isBusy()).toBe(false);}
  finally{late.resolve();owner.dispose();dispose();}
 }
});

const readingClient=await Bun.file(new URL('../src/lib/reading/client.svelte.ts',import.meta.url)).text();
const openScript=readingClient.slice(readingClient.indexOf('export async function openReading'),readingClient.indexOf('export async function attachReading')).replace('export async function','async function');
const openerCode=compileRunes(`
 export function create(api){
  const reader=$state({loading:false,unsaved:false,error:'',session:null,location:null});
  let generation=0,opening=null;const retired=[];
  function cancelOpening(){generation++;opening?.abort();opening=null;reader.loading=false;}
  const retireSession=async session=>{retired.push(session.id);};
  const message=error=>error.message,recordReading=async()=>true,closeReading=async()=>{},install=()=>{throw Error('Cancelled work was installed');};
  ${openScript}
  return {openReading,reader,retired};
 }`);
const {create:createOpener}=await import(moduleUrl(openerCode));
test('external picker cancellation clears the current loading owner and retires any late prepared session',async()=>{
 let finish!:(session:unknown)=>void;
 const owner=createOpener(()=>new Promise(resolve=>finish=resolve)),cancel=new AbortController();
 const pending=owner.openReading('work',{connectionId:'connection',externalId:'copy'},cancel.signal);
 expect(owner.reader.loading).toBe(true);cancel.abort();finish({id:'obsolete-session'});await pending;
 expect(owner.reader.loading).toBe(false);expect(owner.reader.session).toBeNull();expect(owner.reader.error).toBe('');
 expect(owner.retired).toEqual(['obsolete-session']);
 const already=new AbortController();already.abort();await owner.openReading('work',{connectionId:'connection',externalId:'copy'},already.signal);
 expect(owner.reader.loading).toBe(false);
});

test('exit fences pending and new external navigation before animation can save another location',async()=>{
 const motion=deferred(),targets:unknown[]=[];let owner:any;
 const dispose=runtime.effect_root(()=>owner=create(async()=>({next:async()=>{},go:async(location:unknown)=>{targets.push(location);await motion.promise;},leave:async()=>{},destroy(){}})));
 try{await settle();const pending=owner.navigate({format:'pdf',page:2,total:3});await owner.exit();motion.resolve();await pending;await owner.navigate({format:'pdf',page:3,total:3});expect(targets).toHaveLength(1);expect(owner.calls.filter((value:string)=>value==='record')).toEqual([]);expect(owner.location).toBeNull();}
 finally{motion.resolve();dispose();}
});
