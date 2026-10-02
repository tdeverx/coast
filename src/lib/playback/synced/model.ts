export type RoomState = {
  id:string;hostId:string;mediaId:string;mediaType:'audio'|'video';edition:string;durationSeconds:number;
  positionSeconds:number;paused:boolean;bufferingPaused:boolean;bufferingPolicy:'together'|'catch-up';
  queue:string[];queueIndex:number;queueItems:{id:string;title:string;availability:string}[];revision:number;updatedAt:string;serverTime:string;ended:boolean;
  participants:{userId:string;username:string;joined:boolean;buffering:boolean;online:boolean}[];
};
export function timelinePosition(room:Pick<RoomState,'positionSeconds'|'paused'|'bufferingPaused'|'updatedAt'|'durationSeconds'>,now:number) {
  return Math.min(room.durationSeconds,Math.max(0,room.positionSeconds+(!room.paused&&!room.bufferingPaused?Math.max(0,now-Date.parse(room.updatedAt))/1000:0)));
}
export function compatibleSource(room:{mediaId:string;mediaType:string;edition:string;durationSeconds:number},playback:{mediaId:string;mediaType:string;edition:string|null;durationSeconds:number|null}) {
  return room.mediaId===playback.mediaId && room.mediaType===playback.mediaType && room.edition===(playback.edition||'') && room.durationSeconds>0 && !!playback.durationSeconds && Math.abs(room.durationSeconds-playback.durationSeconds)<=2;
}
