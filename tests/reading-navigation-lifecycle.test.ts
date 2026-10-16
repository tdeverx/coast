import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';

const script=(await componentScript('src/lib/reading/Reader.svelte'))
 .replace('let host:HTMLElement,engine:', 'let host:HTMLElement=fixtureHost,engine:')
 .replace("import('./reader/engine')",'Promise.resolve({createReader})')
 .replace('$props()', '({example:previewExample})');
const code=compileRunes(`
 import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
 import {sameReadingLocation} from ${JSON.stringify(import.meta.resolve('../src/lib/reading/model'))};
 export function create(createReader,control=true,previewMode=false,previewExample=undefined){
  const applicationReader=$state({session:{id:'first',url:'fixture.pdf',format:'pdf',location:null,workId:'work',edition:'edition'},file:null,visible:true,rendering:false,location:null,error:''});
  const useClient=()=>({preview:previewMode}),calls=[];
  const syncedPlayer={room:{mediaType:'reading',mediaId:'work',edition:'edition',readingFormat:'pdf',reading:{format:'pdf',page:1,total:2}}};
  const canControlPlayback=()=>control,fixtureHost={},message=error=>error.message;
  const api=async()=>{calls.push('api');},recordReading=async()=>{calls.push('record');return true;},publishReading=()=>{calls.push('publish');},setReadingNavigator=()=>{calls.push('navigator');},closeReading=async()=>{calls.push('close');},retryReadingSave=async()=>{calls.push('retry');};
  ${script}
  return {turn,calls,openPreview(){sample.visible=true;},closePreview:close,get previewVisible(){return sample.visible;},get location(){return reader.location;},get live(){return applicationReader;},replace(){applicationReader.session={...applicationReader.session,id:'replacement'};},hide(){applicationReader.visible=false;},show(){applicationReader.visible=true;},get busy(){return busy;},get external(){return external;},get error(){return reader.error;}};
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

const launchScript=(await componentScript('src/lib/reading/ReadingLaunch.svelte')).replace('$props()', '({workId:"work",title:"Preview book",onopened:opened})').replace('export async function show', 'async function show');
const launchCode=compileRunes(`
 export function create(transport,opened){
  const reader=$state({session:{workId:'work'},visible:false});
  const useClient=()=>({api:transport,preview:true}),createOperation=()=>({run:async task=>task(),error:'',busy:false});
  let realOpenCalls=0;const openReading=async()=>{realOpenCalls++;};
  ${launchScript}
  return {show,choose,get open(){return open;},get liveVisible(){return reader.visible;},get realOpenCalls(){return realOpenCalls;}};
 }`);
const {create:createLaunch}=await import(moduleUrl(launchCode));
test('preview reading edition choice never resumes a live singleton or opens/uploads the chosen file',async()=>{
 const calls:string[]=[];let opened=0;
 const owner=createLaunch(async(path:string)=>{calls.push(path);return [{id:'preview-connection',name:'Preview Jellyfin'}];},async()=>{opened++;});
 await owner.show();expect(owner.open).toBe(true);expect(owner.liveVisible).toBe(false);expect(calls).toEqual(['reading/work/connections']);
 await owner.choose({file:new File(['not decoded'],'preview.cbz')});
 expect(owner.open).toBe(false);expect(owner.realOpenCalls).toBe(0);expect(opened).toBe(0);expect(calls).toHaveLength(1);
});
