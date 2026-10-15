import {expect,test} from 'bun:test';
const deferred=<T=unknown>()=>{let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const source=await Bun.file(new URL('../src/routes/share/+page.svelte',import.meta.url)).text();
const script=source.slice(source.indexOf('<script lang="ts">')+18,source.indexOf('</script>')).replace(/^ import .*;$/gm,'');
const compiled=new Bun.Transpiler({loader:'ts'}).transformSync(script);
function route(options:{shared?:unknown;stop?:()=>Promise<void>;fetch?:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>}={}){
 let mount!:()=>()=>void,tick!:()=>Promise<void>,authority=false,revision=0;
 const calls:{stops:string[];alignments:string[];plays:string[];signals:AbortSignal[];cleared:number}={stops:[],alignments:[],plays:[],signals:[],cleared:0};
 const player={session:{id:'shared'}};
 const create=new Function('onMount','untrack','$props','$state','stopPlayback','setPlaybackApi','fetch','alignPlayback','playMedia','player','setInterval','clearInterval','location','history','page','message',compiled+';return {open};');
 const control=create((callback:typeof mount)=>mount=callback,(read:()=>unknown)=>read(),()=>({data:{shared:'shared' in options?options.shared:{workId:'work',together:true,host:false}}}),(value:unknown)=>value,
  ()=>{calls.stops.push(player.session.id);return options.stop?.()??Promise.resolve();},
  (shared:boolean)=>{const own=++revision;authority=shared;return ()=>{if(own===revision)authority=false;};},
  (input:RequestInfo|URL,init?:RequestInit)=>{calls.signals.push(init!.signal as AbortSignal);return options.fetch?.(input,init)??Promise.resolve(Response.json({workId:'work',together:true,host:false,paused:true,positionSeconds:10,durationSeconds:100,updatedAt:new Date().toISOString()}));},
  ()=>calls.alignments.push(player.session.id),(id:string)=>{calls.plays.push(id);return Promise.resolve();},player,
  (callback:typeof tick)=>{tick=callback;return 1;},()=>calls.cleared++,{hash:'',pathname:'/share',search:''},{},{url:new URL('https://fixture.invalid/share')},(cause:Error)=>cause.message);
 const cleanup=mount();
 return {...control,cleanup,tick:()=>tick(),calls,player,get authority(){return authority;}};
}
for(const failed of [false,true])test(`disposed share poll ${failed?'failure':'success'} cannot control successor playback`,async()=>{
 const response=deferred<Response>(),fixture=route({fetch:()=>response.promise});await settle();
 const pending=fixture.tick();expect(fixture.calls.signals).toHaveLength(1);fixture.cleanup();await settle();fixture.player.session={id:'successor'};
 expect(fixture.calls.signals[0].aborted).toBe(true);
 if(failed)response.reject(new Error('old request failed'));else response.resolve(Response.json({together:true,host:false,paused:true,positionSeconds:30,durationSeconds:100}));
 await pending;expect(fixture.calls.stops).toEqual(['shared','shared']);expect(fixture.calls.alignments).toEqual([]);expect(fixture.calls.cleared).toBe(1);expect(fixture.authority).toBe(false);
});
test('a mount preparation settling after disposal cannot reinstall share authority or open playback',async()=>{
 const stopped=deferred<void>();let count=0;
 const fixture=route({stop:()=>++count===1?stopped.promise:Promise.resolve()});
 const opening=fixture.open();fixture.cleanup();await settle();stopped.resolve();await opening;await settle();
 expect(fixture.authority).toBe(false);expect(fixture.calls.plays).toEqual([]);expect(fixture.calls.signals).toEqual([]);
});
test('active together polling stays single flight and aligns the existing player',async()=>{
 const response=deferred<Response>(),fixture=route({fetch:()=>response.promise});await settle();
 const pending=fixture.tick();await fixture.tick();expect(fixture.calls.signals).toHaveLength(1);
 response.resolve(Response.json({together:true,host:false,paused:true,positionSeconds:30,durationSeconds:100}));await pending;
 expect(fixture.calls.alignments).toEqual(['shared']);expect(fixture.authority).toBe(true);fixture.cleanup();await settle();expect(fixture.authority).toBe(false);
});
test('an invitation claim completing after disposal cannot fetch state or start playback',async()=>{
 const response=deferred<Response>(),fixture=route({shared:null,fetch:()=>response.promise});await settle();
 const opening=fixture.open();await settle();expect(fixture.calls.signals).toHaveLength(1);fixture.cleanup();
 response.resolve(Response.json({ok:true}));await opening;await settle();
 expect(fixture.calls.signals).toHaveLength(1);expect(fixture.calls.plays).toEqual([]);expect(fixture.authority).toBe(false);
});
