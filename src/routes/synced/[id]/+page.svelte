<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import {joinSynced,syncedPlayer} from '#lib/playback/synced/client.svelte.js';
  import {api,message} from '#lib/ui/client.js'; import type {RoomState} from '#lib/playback/synced/model.js';
  import Heading from '#lib/ui/components/Heading.svelte'; import Button from '#lib/ui/components/Button.svelte';
  let {data}=$props();let failure=$state('');
  async function join(){try{const room=await api<RoomState>(`synced/${data.room.id}`,undefined,'GET');await joinSynced(room);}catch(cause){failure=message(cause);}}
  reportFailure(()=>failure);
</script>
<svelte:head><title>Synced session · Coast</title></svelte:head>
<div class="content page">
  <Heading title="Synced session" variant="page"
    description={data.room.ended ? 'This session has ended.' : 'Join with your own Jellyfin source. Playback follows the host.'} />
  {#if !data.room.ended}
    <Button disabled={syncedPlayer.busy} onclick={join}>{syncedPlayer.busy ? 'Preparing your source…' : 'Join session'}</Button>
  {/if}
</div>
