<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, message } from '$lib/ui/client';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { gameHero } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import { gameFacts } from '$lib/games/presentation';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  let { data } = $props();
  const overview = $derived(overviewPanels(data.item.overview,gameFacts(data.item)));
  let busy = $state(false),
    failure = $state('');
  async function add() {
    busy = true;
    failure = '';
    try {
      const game = await api<{ id: string }>('games/import', {
        instanceId: data.instanceId,
        externalId: data.item.externalId,
      });
      await goto(`/games/${game.id}`);
    } catch (cause) {
      failure = message(cause);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaPage details
  item={gameHero(
    { ...data.item, id: data.item.externalId },
    `/games/igdb/${data.instanceId}/${data.item.externalId}`
  )}
>
  {#snippet heroActions()}
    <Button variant="ghost" href={`/games?view=igdb&instance=${data.instanceId}`} icon="left"
      >Games</Button
    >
    <Button variant="hero" icon="plus" disabled={busy} onclick={add}
      >{busy ? 'Adding…' : 'Add game'}</Button
    >
  {/snippet}


  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
  {#if overview.length}<Shelf title="Overview" size="panel" artworkOptions={false} panels={overview} />{/if}
</MediaPage>
