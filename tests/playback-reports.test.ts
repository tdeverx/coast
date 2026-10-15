import {expect,test} from 'bun:test';
import {createPlaybackReports} from '../src/lib/playback/reports';
const deferred=()=>{let resolve!:(value:boolean)=>void;const promise=new Promise<boolean>(done=>resolve=done);return {promise,resolve};};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test('slow delivery retains only the latest consecutive progress and drains the final stop',async()=>{
 const enqueue=createPlaybackReports(),held=deferred(),calls:number[]=[];
 const first=enqueue('a','progress',async()=>{calls.push(0);return held.promise;});
 const pending=[];
 for(let position=10;position<=590;position+=10)pending.push(enqueue('a','progress',async()=>{calls.push(position);return true;}));
 const stop=enqueue('a','stop',async()=>{calls.push(600);return true;});
 await settle();expect(calls).toEqual([0]);held.resolve(true);
 expect(await stop).toBe(true);await Promise.all([first,...pending]);expect(calls).toEqual([0,590,600]);
});
test('coalescing never crosses lifecycle or session boundaries and a failed report does not block drain',async()=>{
 const enqueue=createPlaybackReports(),held=deferred(),calls:string[]=[];
 const send=(name:string,ok=true)=>async()=>{calls.push(name);return ok;};
 void enqueue('a','start',async()=>{calls.push('start');return held.promise;});
 void enqueue('a','progress',send('old'));void enqueue('a','progress',send('latest'));
 void enqueue('a','pause',send('pause'));void enqueue('a','progress',send('after pause',false));
 void enqueue('b','progress',send('b'));void enqueue('a','ended',async()=>{calls.push('ended');throw Error('offline');});
 const stop=enqueue('a','stop',send('stop'));held.resolve(true);await stop;
 expect(calls).toEqual(['start','latest','pause','after pause','b','ended','stop']);
});
test('actual player report preserves start acknowledgement retry and final listening accounting',async()=>{
 const source=await Bun.file(new URL('../src/lib/ui/components/PersistentPlayer.svelte',import.meta.url)).text();
 const handler=source.slice(source.indexOf('  async function report('),source.indexOf('  function playing()'));
 const calls:{event:string;positionSeconds:number;playedSeconds?:number}[]=[];
 let fail=true;const request=async(_path:string,payload:any)=>{calls.push(payload);if(fail){fail=false;throw Error('offline');}};
 const create=new Function('createPlaybackReports','capturePlaybackApi',new Bun.Transpiler({loader:'ts'}).transformSync(`
 let preview=false,active=true,startedSessionId='a',acknowledgedSessionId='',current=12,duration=100,audioMode=true,playedSeconds=7,trackingNotice='';
 const reports=createPlaybackReports(),player={session:{id:'a',startSeconds:0,durationSeconds:100},subtitlePrompt:false},media={paused:false};function accountPlayed(){};
 ${handler}
 return {report,position:(n:number,played:number)=>{current=n;playedSeconds=played;},notice:()=>trackingNotice};`));
 const fixture=create(createPlaybackReports,()=>request);
 expect(await fixture.report('start')).toBe(false);expect(fixture.notice()).toContain('Tracking');
 fixture.position(30,19);expect(await fixture.report()).toBe(true);
 fixture.position(40,25);expect(await fixture.report('stop')).toBe(true);
 expect(calls.map(call=>call.event)).toEqual(['start','start','progress','stop']);
 expect(calls.at(-1)).toMatchObject({positionSeconds:40,playedSeconds:25,event:'stop'});expect(fixture.notice()).toBe('');
});
