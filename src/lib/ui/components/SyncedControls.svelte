<script lang="ts">
  import {syncedPlayer,startSynced,isSyncHost,syncedCommand,leaveSynced} from '$lib/playback/synced/client.svelte';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import { createFriendsResource } from '$lib/ui/friends.svelte';
  import Dialog from './Dialog.svelte'; import Button from './Button.svelte'; import RowFilter from './RowFilter.svelte';

  const { preview, change } = useClient();

  const friends = createFriendsResource();
  let open=$state(false),failure=$state(''),recipient=$state(''),sending=$state(false);
  const busy=$derived(sending || friends.busy);
  const load=(reset=false)=>friends.load(reset);
  export async function show(){if(preview)return;open=true;failure='';if(!syncedPlayer.room)await startSynced();if(isSyncHost())await load(true);}
  async function invite(){sending=true;try{await change(`synced/${syncedPlayer.room!.id}/invite`,{friendId:recipient});recipient='';}catch(cause){failure=message(cause);}finally{sending=false;}}
</script>
<Dialog bind:open title="Synced session · Experimental">
  <div class="stack">
    {#if syncedPlayer.room}
      <p class="small">{isSyncHost()?'You control playback.':'The host controls playback.'} {syncedPlayer.room.bufferingPaused?'Waiting for participants to be ready.':''}</p>
      {#each syncedPlayer.room.participants as member}<div class="spread"><span>{member.username}{member.userId===syncedPlayer.room.hostId?' · Host':''}</span><span class="small">{!member.joined?'Invited':!member.online?'Disconnected':member.buffering?'Buffering':'Ready'}</span></div>{/each}
      {#if isSyncHost()}
        <RowFilter label="Buffering" value={syncedPlayer.room.bufferingPolicy} options={[{value:'together',label:'Pause together'},{value:'catch-up',label:'Continue and catch up'}]} onchange={policy=>syncedCommand('policy',{policy})} />
        <RowFilter label="Invite a friend" value={recipient} options={[{value:'',label:'Choose a friend'},...friends.items.map(f=>({value:f.userId,label:f.username}))]} onchange={value=>recipient=value} />
        {#if friends.more}<Button variant="ghost" disabled={busy} onclick={()=>load()}>Load more friends</Button>{/if}
        <Button disabled={!recipient||busy} onclick={invite}>Invite</Button>
      {/if}
      <Button variant="ghost" onclick={async()=>{await leaveSynced();open=false;}}>{isSyncHost()?'End session':'Leave session'}</Button>
    {/if}
    {#if failure||friends.error||syncedPlayer.notice}<p class="notice" role="status">{failure||friends.error||syncedPlayer.notice}</p>{/if}
  </div>
</Dialog>
