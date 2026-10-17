<script lang="ts">
  import {page} from '$app/state';
  import { goto } from '$app/navigation';
  import { message } from '$lib/ui/client';
  import {useClient} from '$lib/ui/client-context';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { gameHero, gameFacts } from '$lib/games/presentation';
  import Button from '$lib/ui/components/Button.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  let { data }: {data:{item:import('$lib/games/presentation').GameMetadata&{externalId:string};instanceId:string}} = $props();
  const {change,preview}=useClient();
  const section=$derived(page.url.searchParams.get('section'));
  const href=$derived(`/games/igdb/${data.instanceId}/${data.item.externalId}`);
  const overview = $derived(overviewPanels(data.item.overview,gameFacts(data.item)));
  let busy = $state(false),
    failure = $state('');
  async function add() {
    busy = true;
    failure = '';
    try {
      const game = await change<{ id: string }>('games/import', {
        instanceId: data.instanceId,
        externalId: data.item.externalId,
      });
      if(!preview)await goto(`/games/${game.id}`);
    } catch (cause) {
      failure = message(cause);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaPage details hero={!section}
  item={gameHero(
    { ...data.item, id: data.item.externalId },
    `/games/igdb/${data.instanceId}/${data.item.externalId}`,
    false
  )}
>
  {#if section}<Button emphasis="subtle" href={href} icon="left">{data.item.title}</Button>{/if}
  {#snippet heroActions()}
    <Button emphasis="subtle" href={`/games?view=igdb&instance=${data.instanceId}`} icon="left"
      >Games</Button
    >
    <Button size="hero" icon="plus" disabled={busy} onclick={add}
      >{busy ? 'Adding…' : 'Add game'}</Button
    >
  {/snippet}


  {#if failure}<div class="notice error" role="alert">{failure}</div>{/if}
  {#if overview.length}<Shelf title="Insights" href={!section?`${href}?section=insights`:undefined} layout={section?'grid':'row'} size="panel" artworkOptions={false} panels={overview} />{/if}
</MediaPage>
