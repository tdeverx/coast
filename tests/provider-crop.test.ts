import {expect,test} from 'bun:test';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';
import {providerVideoCrop} from '../src/lib/playback/provider-crop.server';
import {companionFrameCrop} from '../src/lib/playback/crop';
import type {PlaybackSource} from '../src/lib/providers/contracts';
const source={streams:[{type:'Video',width:1920,height:1080}]} as PlaybackSource;
test('the companion crop endpoint accepts any selected video ID with the existing authenticated transport',async()=>{
 const calls:{path:string;init?:RequestInit}[]=[];
 const adapter=new JellyfinAdapter(async(path,init)=>{calls.push({path,init});return {Crop:{Width:1920,Height:800,X:0,Y:140},Error:null};},'device','secret');
 for(const id of ['movie-item','episode-item','trailer-item']){
  expect(await providerVideoCrop(adapter,id,source)).toEqual({left:0,right:0,top:140/1080,bottom:140/1080});
  const call=calls.at(-1)!;expect(call.path).toBe('/Coast/TrailerCrop');expect(JSON.parse(call.init!.body as string)).toEqual({ItemId:id});
  expect((call.init!.headers as Record<string,string>).Authorization).toContain('Token="secret"');
 }
});
test('companion metadata validates bounds and handles absent/disabled plugins without losing playback',async()=>{
 expect(companionFrameCrop({Width:2000,Height:800,X:0,Y:140},1920,1080)).toBeNull();
 expect(companionFrameCrop({Width:1920,Height:0,X:0,Y:0},1920,1080)).toBeNull();
 expect(companionFrameCrop({Width:1920,Height:1080,X:0,Y:0},1920,1080)).toEqual({left:0,right:0,top:0,bottom:0});
 const missing=new JellyfinAdapter(async()=>{throw new ProviderHttpError(404);},'device');
 expect(await providerVideoCrop(missing,'movie',source)).toBeNull();
 const failed=new JellyfinAdapter(async()=>({Crop:null,Error:'analysis_failed'}),'device');
 expect(await providerVideoCrop(failed,'episode',source)).toBeNull();
 const abort=new AbortController();abort.abort();
 await expect(providerVideoCrop(missing,'movie',source,abort.signal)).rejects.toThrow();
});
