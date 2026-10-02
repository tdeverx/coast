import {expect,test} from 'bun:test';
import {compatibleSource,timelinePosition} from '../src/lib/playback/synced/model';
import {isExperimentalPath} from '../src/lib/server/experimental';
test('timeline freezes for host pause and group buffering, and clamps to duration',()=>{
 const base={positionSeconds:30,paused:false,bufferingPaused:false,updatedAt:new Date(10000).toISOString(),durationSeconds:100};
 expect(timelinePosition(base,20000)).toBe(40);
 expect(timelinePosition({...base,paused:true},20000)).toBe(30);
 expect(timelinePosition({...base,bufferingPaused:true},20000)).toBe(30);
 expect(timelinePosition(base,200000)).toBe(100);
 expect(timelinePosition(base,0)).toBe(30);
});
test('editions, leaf identity, medium and duration must match',()=>{
 const room={mediaId:'one',mediaType:'video',edition:'extended',durationSeconds:120};
 expect(compatibleSource(room,{...room})).toBe(true);
 for(const other of [{mediaId:'two'},{edition:''},{mediaType:'audio'},{durationSeconds:124},{durationSeconds:0}])expect(compatibleSource(room,{...room,...other})).toBe(false);
});
test('synced pages and API are gated, onboarding stays available without experiments',()=>{
 for(const path of ['/synced/id','/api/v1/synced','/api/v1/synced/id/heartbeat'])expect(isExperimentalPath(path)).toBe(true);
 for(const path of ['/register','/onboarding','/api/v1/admin/invites'])expect(isExperimentalPath(path)).toBe(false);
});
