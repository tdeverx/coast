<script lang="ts">
 import Button from './Button.svelte';
 import {syncedPlayer,isSyncHost as liveIsSyncHost,canControlPlayback as liveCanControlPlayback,canEditPartyQueue as liveCanEditPartyQueue,syncedCommand as liveCommand,updatePartySettings as liveSettings,resyncNow as liveResync,leaveSynced as liveLeave,syncPreferences,setSyncPreferences as livePreferences,localSyncDrift} from '$lib/playback/synced/client.svelte';
 import {player,advanceMusic} from '$lib/playback/client.svelte';
 import {type RoomState,type PartySettings} from '$lib/playback/synced/model';
 import {useClock} from '$lib/ui/clock.svelte';
 import {useClient} from '$lib/ui/client-context';
 import {message} from '$lib/ui/client';
 let {demoRoom}:{demoRoom?:RoomState}=$props();
 const {api,preview}=useClient();
 const clock=useClock();
 const room=$derived(preview?demoRoom:syncedPlayer.room);
 const isSyncHost=()=>preview||liveIsSyncHost();
 const canControlPlayback=()=>preview||liveCanControlPlayback();
 const canEditPartyQueue=()=>preview||liveCanEditPartyQueue();
 const syncedCommand=(...args:Parameters<typeof liveCommand>)=>{if(!preview)return liveCommand(...args);};
 const updatePartySettings=(patch:Partial<PartySettings>)=>{if(!preview)return liveSettings(patch);};
 const setSyncPreferences=(patch:Partial<typeof syncPreferences>)=>{if(!preview)livePreferences(patch);};
 const resyncNow=()=>{if(!preview)return liveResync();};
 const leaveSynced=()=>{if(!preview)return liveLeave();};
 const settings=$derived(room!.settings);
 const self=$derived(room?.participants.find(p=>p.userId===syncedPlayer.userId));
 const drift=$derived.by(()=>{clock.now;return preview?null:localSyncDrift();});
 let saved=$state<{id:string;title:string}[]>([]),loading=$state(false);
 async function loadQueue(){if(preview)return;loading=true;try{saved=(await api<{items:{id:string;title:string}[]}>('music/queue',undefined,'GET')).items.slice(0,200);}catch(cause){syncedPlayer.notice=message(cause);}finally{loading=false;}}
 async function editQueue(index:number,action:'up'|'down'|'remove'){
  if(!room)return;const queue=[...room.queue];let queueIndex=room.queueIndex;
  if(action==='remove'){queue.splice(index,1);if(index<queueIndex)queueIndex--;}
  else{const target=index+(action==='up'?-1:1);[queue[index],queue[target]]=[queue[target],queue[index]];if(queueIndex===index)queueIndex=target;else if(queueIndex===target)queueIndex=index;}
  await syncedCommand('queue',{queue,queueIndex});
 }
 async function playTrack(index:number){if(preview)return;try{player.audioIndex=index-1;await advanceMusic();}catch(cause){syncedPlayer.notice=message(cause);}}
</script>
{#if room}
 <Button menu icon="settings" iconSize={18} size="icon" label="Party options" title="Party options">
  <Button item keepOpen={false} onclick={resyncNow}>Resync</Button>
  <Button menu text="Sync status" label="Sync status">
   <Button item disabled>{drift===null?'No local playback':drift<.25?'Aligned':`${drift.toFixed(1)}s apart`}</Button>
   {#each room.participants as member (member.userId)}
    <Button item disabled>{member.username} — {!member.joined?'Invited':!member.online?'Disconnected':member.unavailable?'Cannot play':member.buffering?'Buffering':settings.readyCheck&&!member.ready?'Not ready':'Ready'}</Button>
   {/each}
  </Button>
  {#if settings.readyCheck}<Button item checked={self?.ready??false} onclick={()=>syncedCommand('ready',{ready:!self?.ready})}>Ready</Button>{/if}
  <Button menu text="Personal" label="Personal">
   <Button item checked={syncPreferences.keepPlaying} onclick={()=>setSyncPreferences({keepPlaying:!syncPreferences.keepPlaying})}>Keep playing when leaving</Button>
   <Button menu text="Playback offset" label="Playback offset">
    <label class="offset-control">{syncPreferences.offsetSeconds>0?'+':''}{syncPreferences.offsetSeconds.toFixed(1)}s
     <input aria-label="Personal playback offset" type="range" min="-5" max="5" step="0.1" value={syncPreferences.offsetSeconds} oninput={event=>setSyncPreferences({offsetSeconds:Number(event.currentTarget.value)})}/>
    </label>
    <Button item onclick={()=>setSyncPreferences({offsetSeconds:0})}>Reset</Button>
   </Button>
  </Button>
  {#if room.mediaType==='audio'}
   <Button menu text="Queue" label="Queue">
    {#each room.queueItems as track,index (`${index}:${track.id}`)}
     <Button menu text={track.title} label={track.title}>
      <Button item disabled={!canControlPlayback()||track.availability!=='available'} keepOpen={false} onclick={()=>playTrack(index)}>Play</Button>
      <Button item disabled={!canEditPartyQueue()||index===0} onclick={()=>editQueue(index,'up')}>Move up</Button>
      <Button item disabled={!canEditPartyQueue()||index===room!.queue.length-1} onclick={()=>editQueue(index,'down')}>Move down</Button>
      <Button item danger disabled={!canEditPartyQueue()||index===room!.queueIndex} onclick={()=>editQueue(index,'remove')}>Remove</Button>
     </Button>
    {/each}
    {#if !room.queue.length}<Button item disabled>Queue empty</Button>{/if}
    <div class="menu-divider" role="separator"></div>
    <Button menu text="Add tracks" label="Add tracks" disabled={!canEditPartyQueue()||room.queue.length>=200} onopen={()=>void loadQueue()}>
     {#if loading}<Button item disabled>Loading</Button>{:else}
      {#each saved.filter(track=>!room!.queue.includes(track.id)) as track (track.id)}<Button item onclick={()=>syncedCommand('queue',{queue:[...room!.queue,track.id],queueIndex:room!.queueIndex})}>{track.title}</Button>{:else}<Button item disabled>No saved tracks to add</Button>{/each}
     {/if}
    </Button>
   </Button>
  {/if}
  {#if isSyncHost()}
   <div class="menu-divider" role="separator"></div>
   <Button menu text="Playback" label="Playback">
    {#each [{value:'host',label:'Host only'},{value:'everyone',label:'Everyone'},{value:'selected',label:'Selected members'}] as option}<Button item selection="radio" checked={settings.playback===option.value} onclick={()=>updatePartySettings({playback:option.value as typeof settings.playback})}>{option.label}</Button>{/each}
    <Button menu text="Controllers" label="Controllers" disabled={settings.playback!=='selected'}>
     {#each room.participants.filter(p=>p.joined&&p.userId!==room!.hostId) as member (member.userId)}<Button item checked={settings.controllers.includes(member.userId)} onclick={()=>updatePartySettings({controllers:settings.controllers.includes(member.userId)?settings.controllers.filter(id=>id!==member.userId):[...settings.controllers,member.userId]})}>{member.username}</Button>{:else}<Button item disabled>No joined guests</Button>{/each}
    </Button>
    <div class="menu-divider" role="separator"></div>
    <Button item checked={settings.readyCheck} onclick={()=>updatePartySettings({readyCheck:!settings.readyCheck})}>Ready check</Button>
   </Button>
   <Button menu text="Buffering" label="Buffering">
    <Button item checked={room.bufferingPolicy==='together'} selection="radio" onclick={()=>syncedCommand('policy',{policy:'together'})}>Pause together</Button>
    <Button item checked={room.bufferingPolicy==='catch-up'} selection="radio" onclick={()=>syncedCommand('policy',{policy:'catch-up'})}>Continue and catch up</Button>
   </Button>
   <Button menu text="Invitations" label="Invitations">
    <Button item checked={settings.acceptInvites} onclick={()=>updatePartySettings({acceptInvites:!settings.acceptInvites})}>Allow new members</Button>
    <div class="menu-divider" role="separator"></div>
    <Button item selection="radio" checked={settings.invitations==='host'} onclick={()=>updatePartySettings({invitations:'host'})}>Host only</Button>
    <Button item selection="radio" checked={settings.invitations==='everyone'} onclick={()=>updatePartySettings({invitations:'everyone'})}>Everyone</Button>
   </Button>
   <Button menu text="Host disconnects" label="Host disconnects">
    {#each [{value:'wait',label:'Wait for host'},{value:'continue',label:'Continue for up to 1 minute'},{value:'transfer',label:'Transfer ownership'}] as option}<Button item selection="radio" checked={settings.hostDisconnect===option.value} onclick={()=>updatePartySettings({hostDisconnect:option.value as typeof settings.hostDisconnect})}>{option.label}</Button>{/each}
   </Button>
   <Button menu text="Queue permissions" label="Queue permissions">
    <Button item selection="radio" checked={settings.queue==='host'} onclick={()=>updatePartySettings({queue:'host'})}>Host only</Button>
    <Button item selection="radio" checked={settings.queue==='everyone'} onclick={()=>updatePartySettings({queue:'everyone'})}>Everyone</Button>
   </Button>
   <div class="menu-divider" role="separator"></div>
   <Button item danger keepOpen={false} onclick={()=>leaveSynced()}>End party</Button>
  {/if}
 </Button>
{/if}
<style>
 .offset-control{display:grid;gap:8px;padding:8px 12px;font-size:var(--text-sm);font-variant-numeric:tabular-nums;}
 input{width:100%;accent-color:var(--accent);}
</style>
