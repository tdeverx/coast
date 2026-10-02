<script lang="ts">
  import {joinSynced,syncedPlayer} from '$lib/playback/synced/client.svelte';
  import {api,message} from '$lib/ui/client'; import type {RoomState} from '$lib/playback/synced/model';
  import Heading from '$lib/ui/components/Heading.svelte'; import Button from '$lib/ui/components/Button.svelte';
  let {data}=$props();let failure=$state('');
  async function join(){try{const room=await api<RoomState>(`synced/${data.room.id}`,undefined,'GET');await joinSynced(room);}catch(cause){failure=message(cause);}}
</script>
<svelte:head><title>Synced session · Coast</title></svelte:head>
<Heading title="Synced session" variant="page" />
<div class="stack form-width"><p>Experimental · Join using your own accessible Jellyfin source. Playback follows the host.</p>
  {#if data.room.ended}<p class="notice">This session has ended.</p>{:else}<Button disabled={syncedPlayer.busy} onclick={join}>{syncedPlayer.busy?'Preparing your source…':'Join session'}</Button>{/if}
  {#if failure||syncedPlayer.notice}<p class="notice error" role="alert">{failure||syncedPlayer.notice}</p>{/if}
</div>
