<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, message } from '$lib/ui/client';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import { gameHero } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import GameOverview from '$lib/ui/components/GameOverview.svelte';
  let { data } = $props();
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
<MediaHero
  item={gameHero(
    { ...data.item, id: data.item.externalId },
    `/games/igdb/${data.instanceId}/${data.item.externalId}`
  )}
>
  {#snippet actions()}
    <Button variant="ghost" href={`/games?view=igdb&instance=${data.instanceId}`} icon="left"
      >Games</Button
    >
    <Button variant="hero" icon="plus" disabled={busy} onclick={add}
      >{busy ? 'Adding…' : 'Add game'}</Button
    >
  {/snippet}
</MediaHero>
<div class="content" style="padding-bottom:90px">
  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
  <GameOverview item={data.item} />
</div>
