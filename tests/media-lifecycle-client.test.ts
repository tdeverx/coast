import {expect,test} from 'bun:test';
import {compileModule} from 'svelte/compiler';
const moduleUrl=(code:string)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const deferred=<T=any>()=>{let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const apiSource=await Bun.file(new URL('../src/lib/ui/client.ts',import.meta.url)).text();
const apiErrors=new Bun.Transpiler({loader:'ts'}).transformSync(apiSource.slice(apiSource.indexOf('export class ApiError'),apiSource.indexOf('export async function api<')));
let fixture=0;
async function loadClient(kind:'reading'|'playback'){
 const unique=++fixture;
 const transportUrl=moduleUrl(`${apiErrors}export const calls=[];export let mode='personal';export const setMode=value=>mode=value;export let handle=async()=>({});export const delivery=fn=>handle=fn;export const message=e=>e.message;export const refreshAfterChange=async()=>{};export const api=(...args)=>{calls.push({mode,args});return handle(...args);};export function capturePlaybackApi(){const captured=mode;return (...args)=>{calls.push({mode:captured,args});return handle(...args);};} // ${unique}`);
 const syncUrl=moduleUrl(`export const commands=[];export const syncedPlayer={room:null,changing:false,joining:false};export const canControlPlayback=()=>true;export const syncedCommand=async(...args)=>{commands.push(args);}; // ${unique}`);
 const playbackUrl=moduleUrl(`export let stop=async()=>{};export const stopWith=fn=>stop=fn;export const stopPlayback=()=>stop(); // ${unique}`);
 const readingUrl=moduleUrl(`export const reader={session:null};export let close=async()=>{};export const closeWith=fn=>close=fn;export const closeReading=()=>close(); // ${unique}`);
 const model=import.meta.resolve('../src/lib/reading/model.ts');
 const filename=kind==='reading'?'../src/lib/reading/client.svelte.ts':'../src/lib/playback/client.svelte.ts';
 const source=await Bun.file(new URL(filename,import.meta.url)).text();
 const code=compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:`${kind}.svelte.js`,generate:'client'}).js.code
  .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'))
  .replaceAll('$lib/ui/client',transportUrl).replaceAll('$lib/ui/diagnostics',moduleUrl('export const browserDiagnostic=()=>{};'))
  .replaceAll('$lib/ui/action-feedback.svelte',moduleUrl('export const notifyAction=()=>{};'))
  .replaceAll('$lib/playback/synced/client.svelte',syncUrl).replaceAll('./synced/client.svelte',syncUrl)
  .replaceAll('$lib/playback/client.svelte',playbackUrl).replaceAll('$lib/reading/client.svelte',readingUrl)
  .replaceAll('./model',model);
 return {client:await import(moduleUrl(code)),transport:await import(transportUrl),sync:await import(syncUrl),playback:await import(playbackUrl),reading:await import(readingUrl)};
}
const readingSession=(id:string)=>({id,workId:'book',title:'Book',format:'pdf',edition:'edition',location:{format:'pdf',page:50,total:100},source:'jellyfin',url:'/file'});
const input={connectionId:'connection',externalId:'external'};

test('acknowledged bookmarks skip identical saves and final flush while failed saves remain retryable',async()=>{
 const {client:c,transport:t}=await loadClient('reading');c.reader.session=readingSession('a');c.reader.location=c.reader.session.location;
 const location=c.reader.location;
 await c.recordReading(location);await c.recordReading({...location});await c.retryReadingSave();await c.closeReading();
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/location'))).toHaveLength(1);
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/close'))).toHaveLength(1);
 c.reader.session=readingSession('b');c.reader.location=location;
 let failed=true;t.delivery(()=>failed?Promise.reject(Error('offline')):Promise.resolve({}));
 expect(await c.recordReading(location)).toBe(false);expect(c.reader.unsaved).toBe(true);
 failed=false;await c.retryReadingSave();expect(c.reader.unsaved).toBe(false);expect(c.reader.error).toBe('');
 expect(t.calls.filter((call:any)=>call.args[0]==='reading/sessions/b/location')).toHaveLength(2);
});
test('bookmark drain skips an identical pending snapshot but retains the newest changed page',async()=>{
 const {client:c,transport:t}=await loadClient('reading'),first=deferred();c.reader.session=readingSession('a');
 const original=c.reader.session.location,next={...original,page:60};let count=0;
 t.delivery(()=>++count===1?first.promise:Promise.resolve({}));
 const saving=c.recordReading(original);c.recordReading({...original});first.resolve({});await saving;
 expect(t.calls).toHaveLength(1);
 const held=deferred();t.delivery(()=>held.promise);
 const changed=c.recordReading(next);c.recordReading({...next,page:70});c.recordReading({...next,page:80});
 held.resolve({});await changed;
 expect(t.calls.map((call:any)=>call.args[1].page)).toEqual([50,60,80]);expect(c.reader.unsaved).toBe(false);
 await c.closeReading();expect(t.calls.filter((call:any)=>call.args[0].endsWith('/location'))).toHaveLength(3);
});
test('a failed delivery invalidates acknowledgement before returning to an older saved location',async()=>{
 const {client:c,transport:t}=await loadClient('reading');c.reader.session=readingSession('a');
 const original=c.reader.session.location;let stored=original,fail=false;
 t.delivery((_path:string,location:any)=>{stored=location;return fail?Promise.reject(Error('Response lost after save')):Promise.resolve({});});
 await c.recordReading(original);fail=true;expect(await c.recordReading({...original,page:60})).toBe(false);
 expect(stored.page).toBe(60);fail=false;await c.recordReading(original);
 expect(stored.page).toBe(50);expect(t.calls).toHaveLength(3);expect(c.reader.unsaved).toBe(false);
});

async function readerEffect(c:any,t:any,go:(location:any)=>Promise<void>){
 const source=await Bun.file(new URL('../src/lib/reading/Reader.svelte',import.meta.url)).text();
 const script=source.match(/<script lang="ts">([^]*?)<\/script>/)![1].replace(/^ import .*;\n/gm,'')
  .replace("import('./reader/engine')",'Promise.resolve({createReader:fixture.createReader})').replace('$props()', '({})');
 const intervals:{callback:()=>void;delay:number}[]=[],cleared:unknown[]=[];
 const fixture={...c,api:t.api,message:(cause:Error)=>cause.message,syncedPlayer:{room:null},canControlPlayback:()=>true,document:{hidden:false},host:{},createReader:async()=>({go,destroy(){}})};
 const declarations='const reportFailure=()=>{};const useClient=()=>({preview:false}),untrack=fn=>fn();const {reader:applicationReader,closeReading,recordReading,publishReading,setReadingNavigator,retryReadingSave,api,message,syncedPlayer,canControlPlayback,document}=fixture;const $state=value=>value,$derived=value=>value;let effect;const $effect=fn=>effect=fn;';
 const compiled=new Bun.Transpiler({loader:'ts'}).transformSync(declarations+script+'\nreturn {start(){host=fixture.host;return effect();},external:()=>external};');
 const mounted=Function('fixture','setInterval','clearInterval',compiled)(fixture,(callback:()=>void,delay:number)=>{intervals.push({callback,delay});return intervals.length;},(id:unknown)=>cleared.push(id));
 const cleanup=mounted.start();await settle();return {cleanup,fixture,intervals,cleared,mounted};
}
test('reader effect fences delayed navigator publication after close and session replacement',async()=>{
 for(const replacement of [null,readingSession('b')])for(const failed of [false,true]){
  const {client:c,transport:t}=await loadClient('reading'),moving=deferred();c.reader.session=readingSession('a');c.reader.location=c.reader.session.location;c.reader.visible=true;
  const effect=await readerEffect(c,t,()=>moving.promise),target={format:'pdf',page:60,total:100};
  const aligning=c.alignReading(target);await settle();effect.cleanup();
  c.reader.session=replacement;c.reader.location=replacement?.location??null;
  if(failed)moving.reject(Error('Late canceled decoder'));else moving.resolve({});await aligning;await settle();
  expect(c.reader.location).toEqual(replacement?.location??null);expect(t.calls).toEqual([]);expect(effect.mounted.external()).toBe(false);
 }
});
test('current reader navigation errors remain observable',async()=>{
 const {client:c,transport:t}=await loadClient('reading');c.reader.session=readingSession('a');c.reader.visible=true;
 const effect=await readerEffect(c,t,async()=>{throw Error('Current decoder failure');});
 await expect(c.alignReading({format:'pdf',page:60,total:100})).rejects.toThrow('Current decoder failure');
 expect(effect.mounted.external()).toBe(false);effect.cleanup();
});
test('reader alignment publishes only the newest completion and keeps its explicit visible minute heartbeat',async()=>{
 const {client:c,transport:t}=await loadClient('reading'),first=deferred(),last=deferred();c.reader.session=readingSession('a');c.reader.location=c.reader.session.location;c.reader.visible=true;
 const effect=await readerEffect(c,t,location=>location.page===60?first.promise:last.promise);
 const older=c.alignReading({format:'pdf',page:60,total:100}),newer=c.alignReading({format:'pdf',page:70,total:100});
 first.resolve({});await older;expect(c.reader.location.page).toBe(50);expect(effect.mounted.external()).toBe(true);
 last.resolve({});await newer;await settle();expect(c.reader.location.page).toBe(70);expect(effect.mounted.external()).toBe(false);
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/location')).map((call:any)=>call.args[1].page)).toEqual([70]);
 expect(effect.intervals.map(timer=>timer.delay)).toEqual([60000]);
 effect.intervals[0].callback();await settle();expect(t.calls.filter((call:any)=>call.args[0].endsWith('/heartbeat'))).toHaveLength(1);
 effect.fixture.document.hidden=true;effect.intervals[0].callback();c.reader.visible=false;effect.fixture.document.hidden=false;effect.intervals[0].callback();await settle();
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/heartbeat'))).toHaveLength(1);effect.cleanup();expect(effect.cleared).toEqual([1]);
});

test('failed final bookmark retains the session and newest location for visible retry',async()=>{
 const {client:c,transport:t}=await loadClient('reading');
 c.reader.session=readingSession('a');c.reader.location=c.reader.session.location;c.reader.visible=true;
 t.delivery((path:string)=>path.endsWith('/location')?Promise.reject(new Error('offline')):Promise.resolve({}));
 await expect(c.closeReading()).rejects.toThrow('Bookmark');
 expect(c.reader.session.id).toBe('a');expect(c.reader.visible).toBe(true);expect(c.reader.unsaved).toBe(true);
 expect(t.calls.some((call:any)=>call.args[0].endsWith('/close'))).toBe(false);
 t.delivery(()=>Promise.resolve({}));
 const newest={format:'pdf',page:60,total:100};await c.recordReading(newest);await c.retryReadingSave();
 expect(c.reader.unsaved).toBe(false);expect(c.reader.error).toBe('');
 await c.closeReading();expect(c.reader.session).toBeNull();
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/location')).at(-1).args[1]).toEqual(newest);
});
test('close during pending reader preparation settles loading and retires a late response',async()=>{
 const {client:c,transport:t,sync}=await loadClient('reading'),prepared=deferred();
 t.delivery((path:string)=>path.endsWith('/session')?prepared.promise:Promise.resolve({}));sync.syncedPlayer.room={id:'room'};
 const pending=c.openReading('book',input);await settle();await c.closeReading();prepared.resolve(readingSession('late'));await pending;
 expect(c.reader.loading).toBe(false);expect(c.reader.session).toBeNull();expect(sync.commands).toEqual([]);
 expect(t.calls.some((call:any)=>call.args[0]==='reading/sessions/late/close')).toBe(true);
});
test('close during playback stop cannot publish a stale reading party item',async()=>{
 const {client:c,transport:t,sync,playback}=await loadClient('reading'),stopped=deferred();
 t.delivery(()=>Promise.resolve(readingSession('late')));sync.syncedPlayer.room={id:'room'};playback.stopWith(()=>stopped.promise);
 const pending=c.openReading('book',input);await settle();await c.closeReading();stopped.resolve({});await pending;
 expect(c.reader.loading).toBe(false);expect(c.reader.session).toBeNull();expect(sync.commands).toEqual([]);
});
test('party attachment invalidates an older explicit reader open',async()=>{
 const {client:c,transport:t}=await loadClient('reading'),prepared=deferred();
 t.delivery((path:string)=>path.endsWith('/session')?prepared.promise:Promise.resolve({}));
 const pending=c.openReading('book',input);await settle();await c.attachReading(readingSession('attached'));
 prepared.resolve(readingSession('old'));await pending;
 expect(c.reader.session.id).toBe('attached');expect(c.reader.loading).toBe(false);
 expect(t.calls.some((call:any)=>call.args[0]==='reading/sessions/old/close')).toBe(true);
});
test('reading party replacement hands over the new source before closing the old one',async()=>{
 const {client:c,transport:t,sync}=await loadClient('reading');
 c.reader.session=readingSession('old');c.reader.location=c.reader.session.location;sync.syncedPlayer.room={id:'room'};
 t.delivery((path:string)=>{if(path==='reading/sessions/old/close')expect(sync.commands).toEqual([['item',{readingSessionId:'new'}]]);return Promise.resolve(path.endsWith('/session')?readingSession('new'):{});});
 await c.openReading('book',input);expect(c.reader.session.id).toBe('new');expect(c.reader.loading).toBe(false);
});
function controller(c:any){const stops:boolean[]=[],resumes:string[]=[];c.registerPlaybackController({stop:async(cancel:boolean)=>{stops.push(cancel);c.player.session=null;c.player.role='idle';},resume:async()=>{resumes.push('resume');},pause:()=>{},beginPlaybackGesture:()=>{},snapshot:()=>({}),align:()=>{}});return {stops,resumes};}
const withDocument=async(run:()=>Promise<void>)=>{const previous=globalThis.document;globalThis.document={createElement:()=>({canPlayType:()=>''})} as unknown as Document;try{await run();}finally{globalThis.document=previous;}};
test('stopping pending playback rejects late publication and retires through captured share authority',()=>withDocument(async()=>{
 const {client:c,transport:t}=await loadClient('playback'),prepared=deferred();controller(c);t.setMode('share');
 t.delivery((path:string)=>path==='playback'?prepared.promise:Promise.resolve({}));
 const pending=c.playMedia('track',{fromStart:true});await settle();await c.stopPlayback();t.setMode('personal');
 prepared.resolve({id:'late',mediaId:'track',startSeconds:12,durationSeconds:100});await pending;
 expect(c.player.session).toBeNull();expect(c.player.role).toBe('idle');expect(c.player.loading).toBe(false);
 const retirement=t.calls.find((call:any)=>call.args[0]==='playback/late/progress');expect(retirement.mode).toBe('share');expect(retirement.args[1].event).toBe('stop');
}));
test('explicit audio recovery prepares a fresh session while ordinary same-item play resumes',()=>withDocument(async()=>{
 const {client:c,transport:t}=await loadClient('playback'),events=controller(c);
 c.player.session={id:'failed',mediaId:'track',mediaType:'audio'};c.player.role='playback';
 await c.playMedia('track',{mediaType:'audio',fromStart:false});expect(events.resumes).toHaveLength(1);expect(t.calls).toHaveLength(0);
 t.delivery(()=>Promise.resolve({id:'new',mediaId:'track',mediaType:'audio',startSeconds:12,durationSeconds:100}));
 await c.playMedia('track',{mediaType:'audio',fromStart:false,retry:true});
 expect(t.calls.filter((call:any)=>call.args[0]==='playback')).toHaveLength(1);expect(c.player.session.id).toBe('new');expect(events.stops).toEqual([false]);
}));
test('cancelling while another reader drains prevents a later playback request',()=>withDocument(async()=>{
 const {client:c,transport:t,reading}=await loadClient('playback'),drained=deferred();controller(c);reading.reader.session={id:'reader'};reading.closeWith(()=>drained.promise);
 const pending=c.playMedia('track',{fromStart:true});await settle();await c.stopPlayback();drained.resolve({});await pending;
 expect(t.calls).toHaveLength(0);expect(c.player.session).toBeNull();expect(c.player.loading).toBe(false);
}));

test('an older failed bookmark cannot replace a newer queued page on retry',async()=>{
 const {client:c,transport:t}=await loadClient('reading'),first=deferred();
 c.reader.session=readingSession('a');let attempts=0;
 t.delivery(()=>{attempts++;return attempts===1?first.promise:Promise.resolve({});});
 const old=c.recordReading({format:'pdf',page:10,total:100});
 c.recordReading({format:'pdf',page:20,total:100});first.resolve(Promise.reject(new Error('offline')));await old;
 await c.retryReadingSave();expect(t.calls.at(-1).args[1]).toEqual({format:'pdf',page:20,total:100});expect(c.reader.unsaved).toBe(false);
});

test('a cancelled preparation cannot clear the loading state of its replacement',()=>withDocument(async()=>{
 const {client:c,transport:t}=await loadClient('playback'),first=deferred(),second=deferred();controller(c);let count=0;
 t.delivery((path:string)=>path==='playback'?(++count===1?first.promise:second.promise):Promise.resolve({}));
 const old=c.playMedia('old',{fromStart:true});await settle();await c.stopPlayback();
 const next=c.playMedia('new',{fromStart:true});await settle();first.resolve({id:'old',mediaId:'old',startSeconds:0,durationSeconds:100});await old;
 expect(c.player.loading).toBe(true);second.resolve({id:'new',mediaId:'new',startSeconds:0,durationSeconds:100});await next;
 expect(c.player.session.id).toBe('new');expect(c.player.loading).toBe(false);
}));

test('a withdrawn reader closes at its rejected page write and does not retry the unaccepted bookmark',async()=>{
 const {client:c,transport:t}=await loadClient('reading');c.reader.session=readingSession('withdrawn');c.reader.visible=true;
 t.delivery((path:string)=>path.endsWith('/location')?Promise.reject(new t.ApiError('Disabled',403,{code:'feature_disabled'})):Promise.resolve({closed:true}));
 expect(await c.recordReading({format:'pdf',page:60,total:100})).toBe(false);
 expect(c.reader.session).toBeNull();expect(c.reader.visible).toBe(false);expect(c.reader.unsaved).toBe(false);
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/location'))).toHaveLength(1);
 expect(t.calls.filter((call:any)=>call.args[0].endsWith('/close'))).toHaveLength(1);
 await c.retryReadingSave();expect(t.calls).toHaveLength(2);
});

test('resource withdrawal distinguishes explicit feature refusal from ordinary permission/network failures',async()=>{
 const {transport:t}=await loadClient('reading');
 expect(t.isFeatureDisabled(new t.ApiError('Disabled',403,{code:'feature_disabled'}))).toBe(true);
 expect(t.isFeatureDisabled(new t.ApiError('Medium disabled',404,{code:'experimental_disabled'}))).toBe(true);
 expect(t.isFeatureDisabled(new t.ApiError('No access',403,{code:'forbidden'}))).toBe(false);
 expect(t.isFeatureDisabled(Error('offline'))).toBe(false);
});

test('a reader already retired by durable cleanup also closes on its terminal session response',async()=>{
 const {client:c,transport:t}=await loadClient('reading');c.reader.session=readingSession('retired');c.reader.visible=true;
 t.delivery((path:string)=>path.endsWith('/location')?Promise.reject(new t.ApiError('Session ended',410)):Promise.resolve({closed:true}));
 expect(await c.recordReading({format:'pdf',page:60,total:100})).toBe(false);
 expect(c.reader.session).toBeNull();expect(c.reader.visible).toBe(false);expect(c.reader.unsaved).toBe(false);
});
