import {test,expect} from 'bun:test';
import {sharedAllocation,playbackLimits,encodingBitrate,sharedResourcePath,publicSharePath} from '../src/lib/sharing/policy';
test('VRChat links give Android an HLS filename while website invitations have normal URLs',()=>{
 const path=publicSharePath('a'.repeat(43),'vrchat');
 expect(new URL(path,'https://coast.test').pathname.endsWith('.m3u8')).toBe(true);
 expect(publicSharePath('a'.repeat(43))).toBe('/share/'+'a'.repeat(43));
});
test('the shared aggregate budget is independent while personal targets retain the server ceiling',()=>{
 expect(playbackLimits(120,{})).toEqual({personal:120_000_000,shared:20_000_000});
 expect(playbackLimits(30,{personalBitrateMbps:12,sharedBitrateMbps:80})).toEqual({personal:12_000_000,shared:80_000_000});
 expect(playbackLimits(4,{personalBitrateMbps:8,sharedBitrateMbps:40})).toEqual({personal:4_000_000,shared:40_000_000});
 expect(sharedAllocation(2_000_000,3)).toEqual({capacity:3,bitrate:550_000});
 expect(sharedAllocation(2_000_000,4).bitrate).toBe(0);
 expect(encodingBitrate(1_000_000,950_000)).toBe(950_000);
 expect(encodingBitrate(1_000_000,1_100_000)).toBe(1_000_000);
 expect(encodingBitrate(1_000_000,1_500_000)).toBe(1_500_000);
});
test('generation rewriting preserves timeline and removes case-insensitive duplicates',()=>{
 const path=sharedResourcePath('/Videos/item/hls1/main/12.ts?playsessionid=old&PLAYSESSIONID=duplicate&deviceId=old&VideoBitRate=900000&runtimeTicks=360000000&MaxWidth=1280',{providerSessionId:'new',providerDeviceId:'viewer',maxBitrate:500000,mediaType:'video',vrchatCodec:'h264'});
 const url=new URL(path,'http://test');
 expect([...url.searchParams.keys()].filter(k=>k.toLowerCase()==='playsessionid')).toEqual(['PlaySessionId']);
 expect(url.searchParams.get('PlaySessionId')).toBe('new');expect(url.searchParams.get('runtimeTicks')).toBe('360000000');expect(url.searchParams.get('MaxWidth')).toBe('1920');expect(url.searchParams.get('VideoBitrate')).toBe('308000');
 const subtitle='/Videos/item/source/Subtitles/0/0/Stream.vtt';expect(sharedResourcePath(subtitle,{providerSessionId:'new',providerDeviceId:'viewer',maxBitrate:500000,mediaType:'video',vrchatCodec:'h264'})).toBe(subtitle);
});
