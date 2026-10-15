import {test,expect} from 'bun:test';
import {sharedAllocation,playbackLimits,encodingBitrate,sharedResourcePath,wantsSharePage} from '../src/lib/sharing/policy';
test('personal limits and aggregate sharing budget stay independent and server-bounded',()=>{
 expect(playbackLimits(120,{})).toEqual({personal:120_000_000,shared:20_000_000});
 expect(playbackLimits(30,{personalBitrateMbps:12,sharedBitrateMbps:80})).toEqual({personal:12_000_000,shared:30_000_000});
 expect(sharedAllocation(2_000_000,3)).toEqual({capacity:3,bitrate:550_000});
 expect(sharedAllocation(2_000_000,4).bitrate).toBe(0);
 expect(encodingBitrate(1_000_000,950_000)).toBe(950_000);
 expect(encodingBitrate(1_000_000,1_100_000)).toBe(1_000_000);
 expect(encodingBitrate(1_000_000,1_500_000)).toBe(1_500_000);
});
test('generation rewriting preserves timeline and removes case-insensitive duplicates',()=>{
 const path=sharedResourcePath('/Videos/item/hls1/main/12.ts?playsessionid=old&PLAYSESSIONID=duplicate&deviceId=old&VideoBitRate=900000&runtimeTicks=360000000&MaxWidth=1280',{providerSessionId:'new',providerDeviceId:'viewer',maxBitrate:500000,mediaType:'video'});
 const url=new URL(path,'http://test');
 expect([...url.searchParams.keys()].filter(k=>k.toLowerCase()==='playsessionid')).toEqual(['PlaySessionId']);
 expect(url.searchParams.get('PlaySessionId')).toBe('new');expect(url.searchParams.get('runtimeTicks')).toBe('360000000');expect(url.searchParams.get('MaxWidth')).toBe('1280');expect(url.searchParams.get('VideoBitrate')).toBe('404000');
 const subtitle='/Videos/item/source/Subtitles/0/0/Stream.vtt';expect(sharedResourcePath(subtitle,{providerSessionId:'new',providerDeviceId:'viewer',maxBitrate:500000,mediaType:'video'})).toBe(subtitle);
});
test('browser documents resolve to the landing page; media probes and native clients resolve to HLS',()=>{
 expect(wantsSharePage(new Request('http://coast/share',{headers:{accept:'text/html,application/xhtml+xml,*/*;q=0.8'}}))).toBe(true);
 expect(wantsSharePage(new Request('http://coast/share',{headers:{accept:'*/*'}}))).toBe(false);
 expect(wantsSharePage(new Request('http://coast/share',{method:'HEAD',headers:{accept:'text/html'}}))).toBe(false);
});
