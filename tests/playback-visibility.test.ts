import {expect,test} from 'bun:test';
import {playbackVisible,heroPlaybackVisible} from '../src/lib/playback/visibility';
test('foreground video hides heroes while playing, paused or buffering; browsing and audio remain accessible',()=>{
 for(const paused of [false,true]){
  const player={session:{mediaType:'video'},browsing:false,paused};
  expect(playbackVisible(player)).toBe(true);
  expect(heroPlaybackVisible(true,player)).toBe(false);
  expect(playbackVisible({...player,browsing:true})).toBe(false);
 }
 const audio={session:{mediaType:'audio'},browsing:false,paused:false};
 expect(playbackVisible(audio)).toBe(false);expect(heroPlaybackVisible(true,audio)).toBe(false);
 expect(heroPlaybackVisible(false,{session:null,browsing:false,paused:true})).toBe(false);
 expect(heroPlaybackVisible(true,{session:null,browsing:false,paused:true})).toBe(true);
});
