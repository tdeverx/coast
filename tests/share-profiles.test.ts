import {expect,test} from 'bun:test';
import {vrchatDeviceProfile,h264Level,hevcLevel} from '../src/lib/sharing/vrchat-profile';
import {sharedResourcePath,publicSharePath,externalShareResourcePath} from '../src/lib/sharing/policy';
import {allocateViewers} from '../src/lib/sharing/allocation';

test('shared viewers target normal playback and reduce only when the aggregate pool requires it',()=>{
 const viewers=Array.from({length:9},(_,i)=>({id:String(i),target:'vrchat' as const,desired_bitrate:null}));
 const eight=allocateViewers(40_000_000,viewers.slice(0,8),viewers[0],4_000_000);
 expect([...eight.values()]).toEqual(Array(8).fill(4_000_000));
 const nine=allocateViewers(40_000_000,viewers,viewers[0],4_000_000);
 expect([...nine.values()]).toEqual(Array(9).fill(3_750_000));
 expect(allocateViewers(40_000_000,[viewers[0]],viewers[0],1_000_000).get('0')).toBe(1_000_000);
 expect(allocateViewers(40_000_000,[viewers[0]],viewers[0],100_000_000).get('0')).toBe(8_192_000);
});

test('resolved child playlists retain an HLS URL hint without mislabelling segments',()=>{
 expect(externalShareResourcePath('viewer','/Videos/item/main.m3u8?api_key=private')).toBe('/api/share/external/viewer/stream.m3u8');
 expect(externalShareResourcePath('viewer','/Videos/item/MASTER.M3U8')).toBe('/api/share/external/viewer/stream.m3u8');
 for(const path of ['/Videos/item/segment.ts','/Videos/item/init.mp4','/Videos/item/segment.m4s','/Videos/item/segment.ts?name=main.m3u8'])expect(externalShareResourcePath('viewer',path)).toBe('/api/share/external/viewer/stream');
});

test('website and VRChat URLs have distinct destinations and only VRChat requests normalization',()=>{
 expect(publicSharePath('grant')).toBe('/share/grant');expect(publicSharePath('grant','vrchat')).toBe('/share/grant.m3u8');
 const original='/Videos/item/master.m3u8?VideoCodec=av1&AudioCodec=opus&MaxWidth=2560&Framerate=59.94&AudioBitrate=256000';
 const session={providerSessionId:'p',providerDeviceId:'d',maxBitrate:2_000_000,mediaType:'video'};
 const web=new URL(sharedResourcePath(original,session),'http://fixture');
 expect(web.searchParams.get('VideoCodec')).toBe('av1');expect(web.searchParams.get('Framerate')).toBe('59.94');expect(web.searchParams.get('AudioBitrate')).toBe('256000');
 for(const codec of ['h264','hevc'] as const){
  const url=new URL(sharedResourcePath(original+'&maxframerate=30&audiochannels=6',{...session,vrchatCodec:codec}),'http://fixture');
  expect(url.searchParams.get('VideoCodec')).toBe(codec);expect(url.searchParams.get('aac-profile')).toBe('lc');
  expect(url.searchParams.get('AudioChannels')).toBe('2');expect(url.searchParams.get('AudioSampleRate')).toBe('48000');
  expect(url.searchParams.get('SegmentContainer')).toBe(codec==='h264'?'ts':'mp4');
  expect([...url.searchParams.keys()].some(k=>k.toLowerCase().includes('framerate'))).toBe(false);
  expect(url.searchParams.get('VideoBitrate')).toBe('1808000');
 }
});
test('device profiles do not pin FPS and level calculation accommodates high frame rate sources',()=>{
 for(const codec of ['h264','hevc'] as const){const p=vrchatDeviceProfile(codec);expect(JSON.stringify(p)).not.toMatch(/framerate/i);expect(p.TranscodingProfiles[0].AudioCodec).toBe('aac');}
 expect(h264Level(1920,1080,23.976)).toBe('41');expect(h264Level(1920,1080,59.94)).toBe('42');expect(h264Level(1920,1080,120)).toBe('51');
 expect(hevcLevel(1920,1080,25)).toBe('120');expect(hevcLevel(1920,1080,60)).toBe('123');expect(hevcLevel(1920,1080,120)).toBe('150');
});
test('website reservations remain stable while VRChat rates share only the remaining budget',()=>{
 const website={id:'web',target:'website' as const,desired_bitrate:1_000_000};
 const native={id:'vrc',target:'vrchat' as const,desired_bitrate:null};
 const rates=allocateViewers(4_000_000,[website],native,4_000_000);
 expect(rates.get('web')).toBe(1_000_000);expect(rates.get('vrc')).toBe(2_400_000);
 const joined=allocateViewers(4_000_000,[website,native],{...native,id:'vrc2'},4_000_000);
 expect(joined.get('web')).toBe(1_000_000);expect(joined.get('vrc')).toBe(1_200_000);expect(joined.get('vrc2')).toBe(1_200_000);
 expect([...joined.values()].reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(3_400_000);
 const denied=allocateViewers(2_000_000,[{...website,desired_bitrate:1_700_000}],native,2_000_000);expect(denied.has('vrc')).toBe(false);
 const oldest=allocateViewers(2_000_000,[native,{...website,desired_bitrate:1_700_000}],native,2_000_000);expect(oldest.has('vrc')).toBe(true);expect(oldest.has('web')).toBe(false);
});
