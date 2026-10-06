import {test,expect} from 'bun:test';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
test('active streams normalize episodes and progress while excluding private session fields',async()=>{
 let route='';const adapter=new JellyfinAdapter(async path=>{route=path;return [{Id:'idle',UserName:'Idle'}, {Id:'playing',UserName:'Alice',RemoteEndPoint:'private-address',AccessToken:'private-token',Client:'TV',NowPlayingItem:{Id:'episode',Name:'Episode title',Type:'Episode',SeriesName:'Show',ParentIndexNumber:0,IndexNumber:3,RunTimeTicks:600000000,Path:'private-path'},PlayState:{IsPaused:true,PositionTicks:300000000,PlayMethod:'Transcode'}}];},'fixture');
 const streams=await adapter.activeStreams();expect(route).toBe('/Sessions?ActiveWithinSeconds=120');expect(streams).toHaveLength(1);expect(streams[0]).toMatchObject({username:'Alice',title:'Show',episode:'S00E03',paused:true,position:30,duration:60,progress:.5});expect(JSON.stringify(streams)).not.toContain('private-');
});
test('unknown runtime stays indeterminate and an excessive position is clamped',async()=>{
 const adapter=new JellyfinAdapter(async()=>[{Id:'one',NowPlayingItem:{Id:'movie',Name:'Movie',RunTimeTicks:0},PlayState:{PositionTicks:999000000}},{Id:'two',NowPlayingItem:{Id:'other',RunTimeTicks:10000000},PlayState:{PositionTicks:999000000}}],'fixture');
 const streams=await adapter.activeStreams();expect(streams[0].progress).toBeNull();expect(streams[1].progress).toBe(1);
});
