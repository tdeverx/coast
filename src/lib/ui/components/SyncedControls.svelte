<script lang="ts">
  import {syncedPlayer,startSynced,isSyncHost,syncedCommand,leaveSynced} from '$lib/playback/synced/client.svelte';
  import {api,message} from '$lib/ui/client';
  import Dialog from './Dialog.svelte'; import Button from './Button.svelte'; import RowFilter from './RowFilter.svelte';
  let open=$state(false),failure=$state(''),recipient=$state(''),busy=$state(false),page=$state(1),more=$state(false);
  let friends=$state<{userId:string;username:string}[]>([]);
  async function load(reset=false){if(busy)return;if(reset){friends=[];page=1;}busy=true;try{const rows=await api<{userId:string;username:string;state:string}[]>(`social/friends?page=${page}`,undefined,'GET');friends=[...friends,...rows.slice(0,60).filter(f=>f.state==='accepted')];more=rows.length>60;page++;}catch(cause){failure=message(cause);}finally{busy=false;}}
  export async function show(){open=true;failure='';if(!syncedPlayer.room)await startSynced();if(isSyncHost())await load(true);}
  async function invite(){busy=true;try{await api(`synced/${syncedPlayer.room!.id}/invite`,{friendId:recipient});recipient='';}catch(cause){failure=message(cause);}finally{busy=false;}}
</script>
<Dialog bind:open title="Synced session · Experimental">
  <div class="stack">
    {#if syncedPlayer.room}
      <p class="small">{isSyncHost()?'You control playback.':'The host controls playback.'} {syncedPlayer.room.bufferingPaused?'Waiting for participants to be ready.':''}</p>
      {#each syncedPlayer.room.participants as member}<div class="spread"><span>{member.username}{member.userId===syncedPlayer.room.hostId?' · Host':''}</span><span class="small">{!member.joined?'Invited':!member.online?'Disconnected':member.buffering?'Buffering':'Ready'}</span></div>{/each}
      {#if isSyncHost()}
        <RowFilter label="Buffering" value={syncedPlayer.room.bufferingPolicy} options={[{value:'together',label:'Pause together'},{value:'catch-up',label:'Continue and catch up'}]} onchange={policy=>syncedCommand('policy',{policy})} />
        <RowFilter label="Invite a friend" value={recipient} options={[{value:'',label:'Choose a friend'},...friends.map(f=>({value:f.userId,label:f.username}))]} onchange={value=>recipient=value} />
        {#if more}<Button variant="ghost" disabled={busy} onclick={()=>load()}>Load more friends</Button>{/if}
        <Button disabled={!recipient||busy} onclick={invite}>Invite</Button>
      {/if}
      <Button variant="ghost" onclick={async()=>{await leaveSynced();open=false;}}>{isSyncHost()?'End session':'Leave session'}</Button>
    {/if}
    {#if failure||syncedPlayer.notice}<p class="notice" role="status">{failure||syncedPlayer.notice}</p>{/if}
  </div>
</Dialog>
