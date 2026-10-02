import {expect,test} from 'bun:test';
import {bufferedAhead,streamHasStopped} from '../src/lib/playback/failures';
// Exercise the player's actual event handlers with a controlled media clock, not real-time sleeps.
const source=await Bun.file(new URL('../src/lib/ui/components/PersistentPlayer.svelte',import.meta.url)).text();
const handlers=source.slice(source.indexOf('  let streamFailure:'),source.indexOf('  function nativeFailure()'));
const code=new Bun.Transpiler({loader:'ts'}).transformSync(handlers);
function monitor(){
 let now=1000,buffer=0;const failures:unknown[]=[];
 const media={ended:false,paused:false,readyState:2,error:null,currentTime:0,buffered:{length:1,start:()=>0,end:()=>buffer}};
 const create=new Function('streamHasStopped','bufferedAhead','performance','setInterval','clearInterval','player','media','error','startedSessionId','failure',code+';return {streamInterrupted,checkStreamFailure};');
 const controls=create(streamHasStopped,bufferedAhead,{now:()=>now},()=>1,()=>{}, {session:{id:'fixture'}},media,'','fixture',(reason:unknown)=>{failures.push(reason);});
 return {controls,media,failures,time:(value:number)=>{now=value;},buffer:(value:number)=>{buffer=value;}};
}
test('repeated stream errors do not postpone an exhausted-playback failure indefinitely',()=>{
 const m=monitor();m.controls.streamInterrupted({status:503});
 for(const time of [3000,5000,7000,9001]){m.time(time);m.controls.streamInterrupted({status:503});m.controls.checkStreamFailure();}
 expect(m.failures).toEqual([{status:503}]);
});
test('buffered content and intentional pause survive network failure, exhausted media eventually fails',()=>{
 const m=monitor();m.buffer(30);m.controls.streamInterrupted({status:503});m.time(10001);m.controls.checkStreamFailure();expect(m.failures).toHaveLength(0);
 m.buffer(0);m.media.paused=true;m.controls.checkStreamFailure();expect(m.failures).toHaveLength(0);
 m.media.paused=false;m.controls.checkStreamFailure();expect(m.failures).toHaveLength(1);
});
