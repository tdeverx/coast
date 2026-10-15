import {expect,test} from 'bun:test';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
const capabilities={containers:['mp4'],videoCodecs:['h264'],audioCodecs:['aac'],nativeHls:false,hlsJs:true};
for(const operation of ['identity','playbackInfo'] as const)test(`owned Jellyfin ${operation} forwards cancellation to its transport`,async()=>{
 const abort=new AbortController(),reason=new DOMException('Playback closed','AbortError');let observed:AbortSignal|undefined;
 const adapter=new JellyfinAdapter(async(_path,init)=>{observed=init?.signal as AbortSignal;return new Promise((_resolve,reject)=>observed!.addEventListener('abort',()=>reject(observed!.reason),{once:true}));},'device');
 const pending=operation==='identity'?adapter.identity(undefined,abort.signal):adapter.playbackInfo('item','user',capabilities,1_000_000,{signal:abort.signal});
 expect(observed).toBe(abort.signal);abort.abort(reason);await expect(pending).rejects.toBe(reason);
});
test('already-cancelled Jellyfin preparation performs no transport work',async()=>{
 let requests=0;const adapter=new JellyfinAdapter(async()=>{requests++;return {};},'device'),abort=new AbortController();abort.abort();
 await expect(adapter.identity(undefined,abort.signal)).rejects.toMatchObject({name:'AbortError'});
 await expect(adapter.playbackInfo('item','user',capabilities,1_000_000,{signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});expect(requests).toBe(0);
});
