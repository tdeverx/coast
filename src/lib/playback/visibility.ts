/** Foreground video hides browsing content even when paused or buffering. */
export function playbackVisible(player:{session:{mediaType?:string}|null;browsing:boolean}) {
  return !!player.session && (player.session.mediaType??'video')==='video' && !player.browsing;
}
/** A hidden hero never plays alongside foreground playback. */
export function heroPlaybackVisible(heroVisible:boolean,player:{session:{mediaType?:string}|null;browsing:boolean;paused:boolean}) {
  return heroVisible && !playbackVisible(player) && (!player.session || player.paused);
}
