import {api,message,ApiError} from '$lib/ui/client';
import {player,playMedia,playbackSnapshot,alignPlayback} from '$lib/playback/client.svelte';
import {timelinePosition,type RoomState} from './model';
export const syncedPlayer=$state({room:null as RoomState|null,userId:'',busy:false,notice:'',changing:false,joining:false});
let offset=0,lastResponse=0,polling=false,generation=0;
export function isSyncHost(){return !!syncedPlayer.room&&syncedPlayer.room.hostId===syncedPlayer.userId;}
function remember(id:string|null){if(id)sessionStorage.setItem('coast:synced',id);else sessionStorage.removeItem('coast:synced');}
function align(){
  const r=syncedPlayer.room;if(!r||syncedPlayer.changing||player.loading||!player.session||player.session.mediaId!==r.mediaId)return;
  alignPlayback({positionSeconds:timelinePosition(r,Date.now()+offset),paused:r.paused||r.bufferingPaused||timelinePosition(r,Date.now()+offset)>=r.durationSeconds-0.1});
}
export async function startSynced(){
  if(!player.session||syncedPlayer.busy)return;
  const epoch=++generation;
  syncedPlayer.busy=true;syncedPlayer.notice='';
  try{const room=await api<RoomState>('synced',{playbackId:player.session.id,positionSeconds:playbackSnapshot()?.positionSeconds||0,queue:player.audioQueue.map(p=>p.id).slice(0,200),queueIndex:Math.max(0,player.audioIndex)});if(epoch!==generation)return;syncedPlayer.room=room;remember(syncedPlayer.room.id);lastResponse=Date.now();offset=Date.parse(syncedPlayer.room.serverTime)-Date.now();align();}
  catch(cause){if(epoch===generation)syncedPlayer.notice=message(cause);}finally{syncedPlayer.busy=false;}
}
async function attachPrepared(id:string,playbackId:string){
  for(let attempt=0;attempt<3;attempt++){
    const latest=await api<RoomState>(`synced/${id}`,undefined,'GET');
    try{return await api<RoomState>(`synced/${id}/join`,{playbackId,revision:latest.revision});}
    catch(cause){if(!(cause instanceof ApiError)||cause.status!==409||attempt===2)throw cause;}
  }
  throw new Error('The session kept changing while joining. Try again.');
}
export async function joinSynced(room:RoomState){
  if(syncedPlayer.busy)return;
  const epoch=++generation;
  syncedPlayer.busy=true;syncedPlayer.changing=true;syncedPlayer.joining=true;syncedPlayer.notice='';
  try{
    const previous=syncedPlayer.room;if(previous&&previous.id!==room.id)await api(`synced/${previous.id}/leave`,{});
    if(epoch!==generation)return;
    syncedPlayer.room=room;
    await playMedia(room.mediaId,{mediaType:room.mediaType,edition:room.edition,expectedDuration:room.durationSeconds,fromStart:true});
    if(epoch!==generation)return;
    const attached=await attachPrepared(room.id,player.session!.id);
    if(epoch!==generation)return;
    syncedPlayer.room=attached;
    if(room.mediaType==='audio'){player.audioQueue=syncedPlayer.room.queueItems;player.audioIndex=syncedPlayer.room.queueIndex;}
    remember(room.id);lastResponse=Date.now();offset=Date.parse(syncedPlayer.room.serverTime)-Date.now();
  }catch(cause){if(epoch!==generation)return;alignPlayback({positionSeconds:0,paused:true});syncedPlayer.room=null;remember(null);syncedPlayer.notice=message(cause);throw cause;}
  finally{syncedPlayer.busy=false;syncedPlayer.changing=false;syncedPlayer.joining=false;align();}
}
export async function syncedCommand(action:'play'|'pause'|'seek'|'policy'|'item'|'end',extra:Record<string,unknown>={}){
  const r=syncedPlayer.room;if(!r)return;
  if(!isSyncHost()){syncedPlayer.notice='Playback is controlled by the host.';align();return;}
  const epoch=generation;
  try{const next=await api<RoomState>(`synced/${r.id}/command`,{action,revision:r.revision,...extra});if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;syncedPlayer.room=next;syncedPlayer.notice='';align();}
  catch(cause){if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;syncedPlayer.notice=message(cause);if(cause instanceof ApiError&&cause.status===409)await pollSynced();}
}
export async function leaveSynced(){
  generation++;
  const r=syncedPlayer.room;syncedPlayer.room=null;remember(null);
  if(r)await api(`synced/${r.id}/leave`,{}).catch(()=>{});
}
export async function pollSynced(){
  const r=syncedPlayer.room;if(!r||polling||syncedPlayer.busy||syncedPlayer.changing)return;
  polling=true;const started=Date.now(), epoch=generation;
  try{
    const snapshot=playbackSnapshot();
    const next=await api<RoomState>(`synced/${r.id}/heartbeat`,{buffering:!snapshot||snapshot.buffering});
    if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
    offset=Date.parse(next.serverTime)-(started+Date.now())/2;lastResponse=Date.now();
    if(next.ended||!next.participants.some(p=>p.userId===syncedPlayer.userId&&p.joined)){
      alignPlayback({positionSeconds:snapshot?.positionSeconds||0,paused:true});syncedPlayer.notice=next.ended?'Synced session ended.':'You are no longer participating.';syncedPlayer.room=null;remember(null);return;
    }
    syncedPlayer.room=next;
    if(next.mediaType==='audio'){player.audioQueue=next.queueItems;player.audioIndex=next.queueIndex;}
    if(player.session?.mediaId!==next.mediaId){
      syncedPlayer.changing=true;
      try{
        await playMedia(next.mediaId,{mediaType:next.mediaType,edition:next.edition,expectedDuration:next.durationSeconds,fromStart:true});
        if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
        const attached=await attachPrepared(r.id,player.session!.id);
        if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
        syncedPlayer.room=attached;
      }catch(cause){if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;syncedPlayer.notice=`Cannot play the current item: ${message(cause)}`;await leaveSynced();alignPlayback({positionSeconds:0,paused:true});}
      finally{syncedPlayer.changing=false;}
    }
    align();
  }catch(cause){if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;syncedPlayer.notice=message(cause);if(cause instanceof ApiError&&[401,403,404].includes(cause.status)){await leaveSynced();alignPlayback({positionSeconds:0,paused:true});}else if(Date.now()-lastResponse>15000)alignPlayback({positionSeconds:playbackSnapshot()?.positionSeconds||0,paused:true});}
  finally{polling=false;}
}
export async function restoreSynced(){
  const id=sessionStorage.getItem('coast:synced'),epoch=generation;if(!id)return;
  try{const room=await api<RoomState>(`synced/${id}`,undefined,'GET');if(epoch!==generation)return;if(room.ended){remember(null);return;}await joinSynced(room);}catch(cause){if(epoch!==generation)return;syncedPlayer.notice=message(cause);if(cause instanceof ApiError&&[401,403,404,410].includes(cause.status))remember(null);}
}
