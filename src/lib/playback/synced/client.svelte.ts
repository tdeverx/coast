import {api,message,ApiError} from '$lib/ui/client';
import {player,playMedia,playbackSnapshot,alignPlayback,stopPlayback} from '$lib/playback/client.svelte';
import {timelinePosition,canControl,compatibleSource,type RoomState,type PartySettings} from './model';
export const syncedPlayer=$state({room:null as RoomState|null,userId:'',busy:false,notice:'',changing:false,joining:false,unavailableMediaId:null as string|null});
let offset=0,lastResponse=0,polling=false,generation=0;
function matchesPlayback(room:RoomState){return !!room.mediaId&&!!player.session&&compatibleSource({...room,mediaId:room.mediaId},{...player.session,mediaType:player.session.mediaType??'video',edition:player.session.edition??''});}
export function isSyncHost(){return !!syncedPlayer.room&&syncedPlayer.room.hostId===syncedPlayer.userId;}
export const syncPreferences=$state({offsetSeconds:0,keepPlaying:true});
export function loadSyncPreferences(){
 try{const value=JSON.parse(localStorage.getItem(`coast:party-preferences:${syncedPlayer.userId}`)||'{}');syncPreferences.offsetSeconds=Number.isFinite(value.offsetSeconds)?Math.max(-5,Math.min(5,value.offsetSeconds)):0;syncPreferences.keepPlaying=value.keepPlaying!==false;}catch{syncPreferences.offsetSeconds=0;syncPreferences.keepPlaying=true;}
}
export function setSyncPreferences(patch:Partial<typeof syncPreferences>){
 if(patch.offsetSeconds!==undefined&&Number.isFinite(patch.offsetSeconds))syncPreferences.offsetSeconds=Math.max(-5,Math.min(5,patch.offsetSeconds));
 if(patch.keepPlaying!==undefined)syncPreferences.keepPlaying=patch.keepPlaying;
 try{localStorage.setItem(`coast:party-preferences:${syncedPlayer.userId}`,JSON.stringify(syncPreferences));}catch{/* Keep the current session preference when browser storage is unavailable. */}
 align(true);
}
export function localSyncDrift(){const r=syncedPlayer.room,snapshot=playbackSnapshot();return r&&snapshot&&matchesPlayback(r)?Math.abs(snapshot.positionSeconds-timelinePosition(r,Date.now()+offset)-syncPreferences.offsetSeconds):null;}
export function canControlPlayback(){return !!syncedPlayer.room&&canControl(syncedPlayer.room,syncedPlayer.userId);}
export function canInviteToParty(){const r=syncedPlayer.room;return !r||r.settings.acceptInvites&&(isSyncHost()||r.settings.invitations==='everyone'&&r.participants.some(p=>p.userId===syncedPlayer.userId&&p.joined));}
export function canEditPartyQueue(){return !!syncedPlayer.room&&(isSyncHost()||syncedPlayer.room.settings.queue==='everyone');}
export function updatePartySettings(patch:Partial<PartySettings>){if(syncedPlayer.room)return syncedCommand('settings',{settings:{...syncedPlayer.room.settings,...patch}});}
export async function resyncNow(){await pollSynced();align(true);}
function remember(id:string|null){if(id)sessionStorage.setItem('coast:synced',id);else sessionStorage.removeItem('coast:synced');}
function align(force=false){
  const r=syncedPlayer.room;if(!r||syncedPlayer.changing||player.loading||!player.session||!matchesPlayback(r))return;
  alignPlayback({positionSeconds:Math.max(0,Math.min(r.durationSeconds,timelinePosition(r,Date.now()+offset)+syncPreferences.offsetSeconds)),paused:r.paused||r.bufferingPaused||timelinePosition(r,Date.now()+offset)>=r.durationSeconds-0.1,force});
}
export async function startSynced(){
  loadSyncPreferences();
  if(syncedPlayer.busy)return;
  const epoch=++generation;
  syncedPlayer.busy=true;syncedPlayer.notice='';
  try{const room=await api<RoomState>('synced',{playbackId:player.session?.id,paused:player.paused,positionSeconds:playbackSnapshot()?.positionSeconds||0,queue:player.audioQueue.map(p=>p.id).slice(0,200),queueIndex:Math.max(0,player.audioIndex)});if(epoch!==generation)return;syncedPlayer.room=room;remember(syncedPlayer.room.id);lastResponse=Date.now();offset=Date.parse(syncedPlayer.room.serverTime)-Date.now();align();}
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
  loadSyncPreferences();
  if(syncedPlayer.busy)return;
  const epoch=++generation;
  syncedPlayer.unavailableMediaId=null;syncedPlayer.busy=true;syncedPlayer.changing=true;syncedPlayer.joining=true;syncedPlayer.notice='';
  try{
    const previous=syncedPlayer.room;if(previous&&previous.id!==room.id)await api(`synced/${previous.id}/leave`,{});
    if(epoch!==generation)return;
    syncedPlayer.room=room;
    if(room.mediaId)await playMedia(room.mediaId,{mediaType:room.mediaType,edition:room.edition,expectedDuration:room.durationSeconds,fromStart:true});
    if(epoch!==generation)return;
    const attached=room.mediaId?await attachPrepared(room.id,player.session!.id):await api<RoomState>(`synced/${room.id}/join`,{revision:room.revision});
    if(epoch!==generation)return;
    syncedPlayer.room=attached;
    player.audioQueue=attached.mediaType==='audio'?attached.queueItems:[];player.audioIndex=attached.mediaType==='audio'?attached.queueIndex:-1;
    remember(room.id);lastResponse=Date.now();offset=Date.parse(syncedPlayer.room.serverTime)-Date.now();
  }catch(cause){if(epoch!==generation)return;alignPlayback({positionSeconds:0,paused:true});syncedPlayer.room=null;remember(null);syncedPlayer.notice=message(cause);throw cause;}
  finally{syncedPlayer.busy=false;syncedPlayer.changing=false;syncedPlayer.joining=false;align();}
}
export async function syncedCommand(action:'play'|'pause'|'seek'|'policy'|'item'|'stop'|'end'|'kick'|'promote'|'settings'|'ready'|'queue',extra:Record<string,unknown>={}){
  const r=syncedPlayer.room;if(!r)return;
  if(!isSyncHost()&&action!=='ready'&&!(action==='queue'?canEditPartyQueue():['play','pause','seek','item','stop'].includes(action)&&canControlPlayback())){syncedPlayer.notice='Playback is controlled by the host.';align();if(action==='item')throw new Error(syncedPlayer.notice);return;}
  const epoch=generation;
  try{
    let revision=r.revision;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const next=await api<RoomState>(`synced/${r.id}/command`,{action,revision,...extra});
        if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
        if(next.revision<syncedPlayer.room.revision)return;
        syncedPlayer.room=next;syncedPlayer.unavailableMediaId=null;syncedPlayer.notice='';
        offset=Date.parse(next.serverTime)-Date.now();lastResponse=Date.now();align();return;
      }catch(cause){
        // Item changes must survive a heartbeat revision race, but recheck authority before retrying.
        if(action!=='item'||!(cause instanceof ApiError)||cause.status!==409||attempt===2)throw cause;
        const latest=await api<RoomState>(`synced/${r.id}`,undefined,'GET');
        if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
        if(latest.ended||!canControl(latest,syncedPlayer.userId))throw cause;
        syncedPlayer.room=latest;revision=latest.revision;
      }
    }
  }
  catch(cause){if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;syncedPlayer.notice=message(cause);if(action==='item')throw cause;if(cause instanceof ApiError&&cause.status===409)await pollSynced();}
}
export async function leaveSynced(){
  generation++;
  const r=syncedPlayer.room;syncedPlayer.unavailableMediaId=null;syncedPlayer.room=null;remember(null);
  if(r)await api(`synced/${r.id}/leave`,{}).catch(()=>{});
  if(!syncPreferences.keepPlaying)await stopPlayback();
}
export async function pollSynced(){
  const r=syncedPlayer.room;if(!r||polling||syncedPlayer.busy||syncedPlayer.changing)return;
  polling=true;const started=Date.now(), epoch=generation;
  try{
    const snapshot=playbackSnapshot();
    const unavailable=!!r.mediaId&&(r.mediaId===syncedPlayer.unavailableMediaId||!!snapshot?.unavailable);
    const next=await api<RoomState>(`synced/${r.id}/heartbeat`,{buffering:!!r.mediaId&&!unavailable&&(!snapshot||snapshot.buffering),unavailable});
    if(epoch!==generation||syncedPlayer.room?.id!==r.id||syncedPlayer.changing||next.revision<syncedPlayer.room.revision)return;
    offset=Date.parse(next.serverTime)-(started+Date.now())/2;lastResponse=Date.now();
    if(next.ended||!next.participants.some(p=>p.userId===syncedPlayer.userId&&p.joined)){
      alignPlayback({positionSeconds:snapshot?.positionSeconds||0,paused:true});syncedPlayer.notice=next.ended?'Synced session ended.':'You are no longer participating.';syncedPlayer.room=null;remember(null);return;
    }
    syncedPlayer.room=next;
    if(!next.mediaId&&player.session){syncedPlayer.changing=true;try{await stopPlayback();}finally{syncedPlayer.changing=false;}}
    player.audioQueue=next.mediaType==='audio'?next.queueItems:[];player.audioIndex=next.mediaType==='audio'?next.queueIndex:-1;
    if(next.mediaId&&next.mediaId!==syncedPlayer.unavailableMediaId&&!matchesPlayback(next)){
      syncedPlayer.changing=true;
      try{
        await playMedia(next.mediaId,{mediaType:next.mediaType,edition:next.edition,expectedDuration:next.durationSeconds,fromStart:true});
        if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
        const attached=await attachPrepared(r.id,player.session!.id);
        if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;
        syncedPlayer.room=attached;
      }catch(cause){if(epoch!==generation||syncedPlayer.room?.id!==r.id)return;syncedPlayer.notice=`Cannot play the current item: ${message(cause)}`;syncedPlayer.unavailableMediaId=next.mediaId;alignPlayback({positionSeconds:0,paused:true});}
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
