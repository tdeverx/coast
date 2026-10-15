import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';

const script=(await componentScript('src/lib/reading/Reader.svelte'))
 .replace('let host:HTMLElement,engine:', 'let host:HTMLElement=fixtureHost,engine:')
 .replace("import('./reader/engine')",'Promise.resolve({createReader})');
const code=compileRunes(`
 import {sameReadingLocation} from ${JSON.stringify(import.meta.resolve('../src/lib/reading/model'))};
 export function create(createReader,control=true){
  const reader=$state({session:{id:'first',url:'fixture.pdf',format:'pdf',location:null,workId:'work',edition:'edition'},file:null,visible:true,rendering:false,location:null,error:''});
  const syncedPlayer={room:{mediaType:'reading',mediaId:'work',edition:'edition',readingFormat:'pdf',reading:{format:'pdf',page:1,total:2}}};
  const canControlPlayback=()=>control,fixtureHost={},message=error=>error.message;
  const api=async()=>{},recordReading=async()=>true,publishReading=()=>{},setReadingNavigator=()=>{},closeReading=async()=>{},retryReadingSave=async()=>{};
  ${script}
  return {turn,replace(){reader.session={...reader.session,id:'replacement'};},hide(){reader.visible=false;},show(){reader.visible=true;},get busy(){return busy;},get external(){return external;},get error(){return reader.error;}};
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
