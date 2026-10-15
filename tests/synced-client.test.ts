import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
const moduleUrl = (code:string)=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const clientUrl = moduleUrl(`export let respond=async()=>{}; export function delivery(fn){respond=fn;} export function api(...args){return respond(...args);} export const message=e=>e.message; export class ApiError extends Error {constructor(status){super('fixture');this.status=status;}}`);
const playbackUrl = moduleUrl(`export const player={session:{id:'playback',mediaId:'media',mediaType:'audio',edition:'',durationSeconds:100},audioQueue:[],audioIndex:0};export const alignments=[];export let stops=0;export const plays=[];export let play=async()=>{};export const playWith=fn=>play=fn;export const playMedia=async(...args)=>{plays.push(args);await play(...args);};export const playbackSnapshot=()=>({positionSeconds:10,buffering:false});export const alignPlayback=state=>alignments.push(state);export const stopPlayback=async()=>{stops++;};`);
const readingUrl = moduleUrl(`export const reader={session:null,location:null,loading:false,rendering:false,syncing:false}; export const alignments=[];export const alignReading=async location=>alignments.push(location);export const attachReading=async session=>{reader.session=session;};export const closeReading=async()=>{reader.session=null;};`);
const modelUrl = moduleUrl('export const compatibleSource=(r,p)=>r.mediaId===p.mediaId&&r.mediaType===p.mediaType&&r.edition===(p.edition||"")&&Math.abs(r.durationSeconds-p.durationSeconds)<=2;export const timelinePosition=()=>10;export const canControl=(r,u)=>r.hostId===u||r.participants.some(p=>p.userId===u&&p.joined)&&(r.settings.playback==="everyone"||r.settings.playback==="selected"&&r.settings.controllers.includes(u));');
const source = await Bun.file(new URL('../src/lib/playback/synced/client.svelte.ts',import.meta.url)).text();
const code = compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source),{filename:'client.svelte.js',generate:'client'}).js.code
 .replaceAll('svelte/internal/client',import.meta.resolve('svelte/internal/client'))
 .replaceAll('$lib/reading/client.svelte',readingUrl).replaceAll('$lib/ui/client',clientUrl).replaceAll('$lib/playback/client.svelte',playbackUrl).replaceAll('./model',modelUrl);
const client = await import(clientUrl);
const sync:typeof import('../src/lib/playback/synced/client.svelte') = await import(moduleUrl(code));
const stored = new Map<string,string>();
globalThis.sessionStorage = {getItem:key=>stored.get(key)??null,setItem:(key,value)=>{stored.set(key,value);},removeItem:key=>{stored.delete(key);},clear:()=>stored.clear(),key:i=>[...stored.keys()][i]??null,get length(){return stored.size;}};
const room:any = {id:'room',revision:0,edition:'',mediaId:'media',mediaType:'audio',hostId:'host',serverTime:new Date().toISOString(),durationSeconds:100,queueItems:[],queueIndex:0,settings:{playback:'host',controllers:[],queue:'host'},participants:[{userId:'host',joined:true}]};
test('a heartbeat delivered after leaving cannot resurrect a synced room',async()=>{
 sync.syncedPlayer.room=room; sync.syncedPlayer.userId='host';
 let complete!:(value:unknown)=>void;
 client.delivery((path:string)=>path.endsWith('/heartbeat')?new Promise(resolve=>{complete=resolve;}):Promise.resolve({}));
 const pending=sync.pollSynced(); await sync.leaveSynced(); complete(room); await pending;
 expect(sync.syncedPlayer.room).toBeNull(); expect(stored.has('coast:synced')).toBe(false);
});
test('a host command delivered after leaving cannot rejoin the room',async()=>{
 sync.syncedPlayer.room=room;
 let complete!:(value:unknown)=>void;
 client.delivery((path:string)=>path.endsWith('/command')?new Promise(resolve=>{complete=resolve;}):Promise.resolve({}));
 const pending=sync.syncedCommand('play'); await sync.leaveSynced(); complete(room); await pending;
 expect(sync.syncedPlayer.room).toBeNull();
});
test('temporary restore failure retains room identity, authoritative rejection removes it',async()=>{
 stored.set('coast:synced','room'); client.delivery(()=>Promise.reject(new TypeError('offline')));
 await sync.restoreSynced(); expect(stored.get('coast:synced')).toBe('room');
 client.delivery(()=>Promise.reject(new client.ApiError(403)));await sync.restoreSynced();expect(stored.has('coast:synced')).toBe(false);
});

test('creating a party sends the current playback state',async()=>{
 const playback=await import(playbackUrl);
 for(const paused of [false,true]){
  playback.player.paused=paused;
  let payload:any;
  client.delivery((_path:string,body:unknown)=>{payload=body;return Promise.resolve({...room,paused});});
  await sync.startSynced();
  expect(payload.paused).toBe(paused);
 }
 await sync.leaveSynced();
});
test('resync forces alignment using the personal offset and leaving honors the playback preference',async()=>{
 const playback=await import(playbackUrl);
 sync.syncedPlayer.userId='host';sync.syncedPlayer.room=room;
 client.delivery((path:string)=>Promise.resolve(path.endsWith('/heartbeat')?room:{}));
 sync.setSyncPreferences({offsetSeconds:2,keepPlaying:false});
 await sync.resyncNow();expect(playback.alignments.at(-1)).toMatchObject({positionSeconds:12,force:true});
 const before=playback.stops;await sync.leaveSynced();expect(playback.stops).toBe(before+1);
 sync.setSyncPreferences({offsetSeconds:0,keepPlaying:true});
});

test('an item transition retries a revision race without losing the new medium',async()=>{
 sync.syncedPlayer.userId='host';sync.syncedPlayer.room={...room,revision:1};sync.syncedPlayer.changing=true;
 const revisions:number[]=[];
 client.delivery((path:string,body:any)=>{
  if(path.endsWith('/command')){revisions.push(body.revision);if(revisions.length===1)return Promise.reject(new client.ApiError(409));return Promise.resolve({...room,mediaId:'new-track',mediaType:'audio',revision:3});}
  return Promise.resolve({...room,revision:2});
 });
 await sync.syncedCommand('item',{playbackId:'new-playback'});
 expect(revisions).toEqual([1,2]);expect(sync.syncedPlayer.room?.mediaId).toBe('new-track');expect(sync.syncedPlayer.notice).toBe('');
 sync.syncedPlayer.changing=false;await sync.leaveSynced();
});
test('item retries stop when control is revoked and propagate failure',async()=>{
 sync.syncedPlayer.userId='host';sync.syncedPlayer.room={...room,revision:1};
 let calls=0;client.delivery((path:string)=>{if(path.endsWith('/command')){calls++;return Promise.reject(new client.ApiError(409));}return Promise.resolve({...room,hostId:'other',revision:2});});
 await expect(sync.syncedCommand('item',{playbackId:'new'})).rejects.toThrow();expect(calls).toBe(1);
 await sync.leaveSynced();
});
test('a delayed heartbeat cannot overwrite a successful video to audio transition',async()=>{
 sync.syncedPlayer.userId='host';sync.syncedPlayer.room={...room,mediaType:'video',revision:1};
 let complete!:(value:unknown)=>void;
 client.delivery((path:string)=>path.endsWith('/heartbeat')?new Promise(resolve=>{complete=resolve;}):Promise.resolve({...room,mediaId:'track',revision:3}));
 const pending=sync.pollSynced();sync.syncedPlayer.changing=true;
 await sync.syncedCommand('item',{playbackId:'new'});sync.syncedPlayer.changing=false;
 complete({...room,mediaType:'video',revision:2});await pending;
 expect(sync.syncedPlayer.room?.mediaType).toBe('audio');expect(sync.syncedPlayer.room?.mediaId).toBe('track');await sync.leaveSynced();
});

test('a denied item transition fails instead of silently leaving local playback unmatched',async()=>{
 sync.syncedPlayer.userId='guest';sync.syncedPlayer.room={...room,revision:1};
 let calls=0;client.delivery(()=>{calls++;return Promise.resolve(room);});
 await expect(sync.syncedCommand('item',{playbackId:'new'})).rejects.toThrow('host');expect(calls).toBe(0);
 await sync.leaveSynced();sync.syncedPlayer.userId='host';
});


test('reading parties use their own session and never overwrite a location while it is publishing',async()=>{
 const reading=await import(readingUrl);
 const session={id:'reading-session',workId:'book',edition:'edition',format:'epub'};
 const location={format:'epub',cfi:'epubcfi(/6/2!/4/2/1:0)',fraction:.25};
 const readingRoom={...room,mediaType:'reading',mediaId:'book',edition:'edition',readingFormat:'epub',reading:location};
 reading.reader.session=session;sync.syncedPlayer.userId='host';reading.reader.syncing=true;
 let payload:any;client.delivery((_path:string,body:unknown)=>{payload=body;return Promise.resolve(readingRoom);});
 try{
  const before=reading.alignments.length;
  await sync.startSynced();expect(payload.readingSessionId).toBe(session.id);expect(payload.playbackId).toBeUndefined();
  expect(reading.alignments).toHaveLength(before);
  reading.reader.syncing=false;await sync.resyncNow();expect(reading.alignments.at(-1)).toEqual(location);
 }finally{reading.reader.session=null;reading.reader.syncing=false;await sync.leaveSynced();}
});


test('party source failures suppress unchanged retries but retry a changed descriptor',async()=>{
 const playback=await import(playbackUrl),reading=await import(readingUrl);
 const joined={...room,hostId:'other',participants:[{userId:'guest',joined:true}],settings:{...room.settings,playback:'host'}};
 let next={...joined,edition:'unavailable'};sync.syncedPlayer.userId='guest';sync.syncedPlayer.room=next;
 playback.player.session=null;reading.reader.session=null;
 playback.playWith(async()=>{throw new Error('missing source');});
 client.delivery((path:string)=>Promise.resolve(path.endsWith('/heartbeat')?next:next));
 const before=playback.plays.length;
 await sync.pollSynced();expect(playback.plays.length).toBe(before+1);expect(sync.syncedPlayer.unavailableMediaId).toBe('media');
 await sync.pollSynced();expect(playback.plays.length).toBe(before+1);
 next={...next,edition:'available',revision:next.revision+1};
 playback.playWith(async(id:string,options:any)=>{playback.player.session={id:'replacement',mediaId:id,mediaType:options.mediaType,edition:options.edition,durationSeconds:options.expectedDuration};});
 await sync.pollSynced();expect(playback.plays.length).toBe(before+2);expect(playback.plays.at(-1)[1].edition).toBe('available');expect(sync.syncedPlayer.unavailableMediaId).toBeNull();
 await sync.leaveSynced();sync.syncedPlayer.userId='host';playback.playWith(async()=>{});
});

test('reading failure descriptors distinguish format and duration without retrying every heartbeat',async()=>{
 const reading=await import(readingUrl),playback=await import(playbackUrl);
 for(const patch of [{readingFormat:'epub'},{durationSeconds:10}]){
  let next:any={...room,hostId:'other',mediaType:'reading',mediaId:'book',edition:'edition',readingFormat:'pdf',participants:[{userId:'guest',joined:true}]};
  sync.syncedPlayer.userId='guest';sync.syncedPlayer.room=next;reading.reader.session=null;playback.player.session=null;
  let matching=0;
  client.delivery((path:string)=>{if(path.includes('/matching')){matching++;return Promise.reject(new Error('no matching copy'));}return Promise.resolve(next);});
  await sync.pollSynced();await sync.pollSynced();expect(matching).toBe(1);
  next={...next,...patch,revision:next.revision+1};await sync.pollSynced();expect(matching).toBe(2);
  await sync.pollSynced();expect(matching).toBe(2);await sync.leaveSynced();
 }
 sync.syncedPlayer.userId='host';
});
