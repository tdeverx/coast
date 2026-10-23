import {expect,test} from 'bun:test';
import {createPlaybackReports} from '../src/lib/playback/reports';
import {createPlaybackStop} from '../src/lib/playback/stop';
const source=await Bun.file(new URL('../src/lib/ui/components/PersistentPlayer.svelte',import.meta.url)).text();
const handlers=source.slice(source.indexOf('  async function report('),source.indexOf('  function playing()'))+source.slice(source.indexOf('  async function close('),source.indexOf('  async function toggle()'))+source.slice(source.indexOf('  async function ended()'),source.indexOf('  async function switchEdition('));
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function fixture(deliver:(input:any)=>Promise<unknown>,party=false,audio=true,read=async()=>({next:null})){
 const states:string[]=[],calls:any[]=[],leaves:boolean[]=[],refreshes:string[]=[];
 const create=new Function('createPlaybackReports','createPlaybackStop','capturePlaybackApi','states','leaves','refreshes','api',new Bun.Transpiler({loader:'ts'}).transformSync(`
 let preview=false,closed=false,active=true,startedSessionId='a',acknowledgedSessionId='a',current=38,duration=100,audioMode=${audio},playedSeconds=24,trackingNotice='',error='';
 let saved=false,saving=false,next=null,advances=0;function sequencePath(){return 'sequence';}async function advanceMusic(){advances++;}
 const player={session:{id:'a',startSeconds:0,durationSeconds:100},role:'playback',paused:false,browsing:true,subtitlePrompt:false},media={paused:false};
 const reports=createPlaybackReports(),stopSave=createPlaybackStop(state=>states.push(state));
 const sharedMode=false,partyRoom=${party?"{id:'room'}":'null'},partyHost=false,syncedPlayer={changing:false,room:partyRoom};
 function accountPlayed(){}function pause(){media.paused=true;}function cancelPlaybackPreparation(){}
 async function leaveSynced(keep:boolean){leaves.push(keep);if(!keep)await close(false);syncedPlayer.room=null;}
 async function syncedCommand(){}async function refreshAfterChange(domain:string){refreshes.push(domain);}
 ${handlers}
 return {player,close,report,ended,loadSequenceNext,readNext:()=>next,advances:()=>advances,wait:()=>stopSave.wait(),retry:()=>stopSave.retry(),clear:()=>stopSave.clear(),setPosition:(n:number)=>current=n};`));
 const controls=create(createPlaybackReports,createPlaybackStop,()=>async(_path:string,input:any)=>{calls.push(input);return deliver(input);},states,leaves,refreshes,read);
 return {...controls,states,calls,leaves,refreshes};
}
for(const audio of [false,true])test(`actual ${audio?'audio':'video'} close releases UI immediately, captures its final state, and waits independently`,async()=>{
 const response=deferred<unknown>(),f=fixture(()=>response.promise,false,audio);await f.close();
 expect(f.player.session).toBeNull();expect(f.player.role).toBe('idle');expect(f.player.paused).toBe(true);
 let ready=false;const waiting=f.wait().then(()=>{ready=true;});await settle();expect(ready).toBe(false);
 expect(f.calls).toHaveLength(1);expect(f.calls[0]).toMatchObject({event:'stop',positionSeconds:38,paused:true});expect(f.calls[0].playedSeconds).toBe(audio?24:undefined);
 f.setPosition(90);response.resolve({});await waiting;
 expect(f.calls[0].positionSeconds).toBe(38);expect(f.refreshes).toEqual(['tracking']);expect(f.states).toEqual(['saving','idle']);
});
test('actual close retries the frozen Stop without repeating party leave or a terminal report',async()=>{
 let attempts=0;const f=fixture(async()=>{if(++attempts===1)throw Error('offline');return {};},true);
 await f.close();await f.close();await settle();expect(f.leaves).toEqual([true]);await expect(f.wait()).rejects.toThrow('Retry');
 f.setPosition(90);expect(await f.retry()).toBe(true);await f.wait();expect(f.calls).toHaveLength(2);
 expect(f.calls.map((input:any)=>input.positionSeconds)).toEqual([38,38]);expect(f.leaves).toEqual([true]);expect(f.refreshes).toEqual(['tracking']);
});
test('queued earlier progress drains before the captured terminal Stop after visual teardown',async()=>{
 const first=deferred<unknown>();let attempts=0;const f=fixture(()=>++attempts===1?first.promise:Promise.resolve({}));
 const progress=f.report();await settle();await f.close();await settle();expect(f.calls.map((x:any)=>x.event)).toEqual(['progress']);
 first.resolve({});await progress;await f.wait();expect(f.calls.map((x:any)=>x.event)).toEqual(['progress','stop']);
 expect(f.player.session).toBeNull();
});

for(const audio of [false,true])test(`a late ${audio?'audio':'video'} Ended acknowledgement cannot reopen stopped playback`,async()=>{
 const held=deferred<unknown>();let count=0;const f=fixture(()=>++count===1?held.promise:Promise.resolve({}),false,audio);
 const ended=f.ended();await settle();await f.close();held.resolve({});await ended;await f.wait();
 expect(f.player.session).toBeNull();expect(f.player.role).toBe('idle');expect(f.advances()).toBe(0);
});
test('a late sequence lookup cannot overwrite successor navigation state',async()=>{
 const held=deferred<any>(),f=fixture(async()=>({}),false,false,()=>held.promise);
 f.player.session.sequence={entryId:'old-entry'};const pending=f.loadSequenceNext('old-entry');
 f.player.session={id:'successor',startSeconds:0,durationSeconds:100};held.resolve({next:{id:'old-next'}});await pending;expect(f.readNext()).toBeNull();
});
