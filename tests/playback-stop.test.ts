import {expect,test} from 'bun:test';
import {createPlaybackStop,type PlaybackSave,type StopSaveState} from '../src/lib/playback/stop';
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
const settle=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};

test('Stop owns one final save and successor waits for its acknowledgement',async()=>{
 const states:StopSaveState[]=[],held=deferred<PlaybackSave>();let calls=0,ready=false;
 const stop=createPlaybackStop(state=>states.push(state));
 stop.start(()=>{calls++;return held.promise;});
 const waiting=stop.wait().then(()=>{ready=true;});await settle();
 expect(states).toEqual(['saving']);expect(calls).toBe(1);expect(ready).toBe(false);
 held.resolve({saved:true});await waiting;expect(ready).toBe(true);expect(states).toEqual(['saving','idle']);
 await stop.wait();expect(calls).toBe(1);
});
test('failed Stop blocks preparation until one explicit retry saves the same snapshot',async()=>{
 const states:StopSaveState[]=[],retry=deferred<PlaybackSave>();let calls=0;
 const stop=createPlaybackStop(state=>states.push(state));
 stop.start(async()=>++calls===1?{saved:false}:retry.promise);await settle();
 await expect(stop.wait()).rejects.toThrow('Retry');expect(calls).toBe(1);
 const first=stop.retry(),second=stop.retry(),waiting=stop.wait();await settle();expect(calls).toBe(2);
 retry.resolve({saved:true});expect(await first).toBe(true);expect(await second).toBe(true);await waiting;
 expect(states).toEqual(['saving','failed','saving','idle']);
});
test('withdrawal releases the barrier without claiming a save; old ownership cannot publish after clear',async()=>{
 const states:StopSaveState[]=[],old=deferred<PlaybackSave>(),next=deferred<PlaybackSave>();
 const stop=createPlaybackStop(state=>states.push(state));stop.start(()=>old.promise);await settle();stop.clear();stop.start(()=>next.promise);await settle();
 old.resolve({saved:true});await settle();expect(states).toEqual(['saving','idle','saving']);
 next.resolve({saved:false,disabled:true});await stop.wait();expect(states).toEqual(['saving','idle','saving','idle']);
});
test('a rejected send stays retryable and another Stop cannot replace unsaved ownership',async()=>{
 const stop=createPlaybackStop(()=>{});stop.start(async()=>{throw Error('offline');});await settle();
 expect(()=>stop.start(async()=>({saved:true}))).toThrow('pending');await expect(stop.wait()).rejects.toThrow('Retry');stop.clear();await stop.wait();
});
