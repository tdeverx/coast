<script lang="ts">
  import {page} from '$app/state';
  import {navigateMedia} from '#lib/ui/media-navigation.js';
  import { message } from '#lib/ui/client.js';
  import {useClient, reportFailure } from '#lib/ui/client-context.js';
  import MediaDetails from '#lib/ui/components/MediaDetails.svelte';
  import type {DetailRowsModel} from '#lib/ui/pages/detail-rows.js';
  import { gameHero, gameFacts } from '#lib/games/presentation.js';
  import Button from '#lib/ui/components/Button.svelte';
  import { overviewPanels } from '#lib/ui/insights/overview.js';
  let { data,detailHref }: {detailHref?:string;data:{item:import('#lib/games/presentation.js').GameMetadata&{externalId:string};instanceId:string}} = $props();
  const {change,preview}=useClient();
  const section=$derived((detailHref?new URL(detailHref,page.url.href):page.url).searchParams.get('section'));
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
      if(!preview)await navigateMedia(`/games/${game.id}`);
    } catch (cause) {
      failure = message(cause);
    } finally {
      busy = false;
    }
  }
  const model=$derived<DetailRowsModel>({insights:{selection:'overview',tabs:[{value:'overview',label:'Overview',panels:overview}],href:`${href}?section=insights`}});
  reportFailure(()=>failure);
</script>

<svelte:head><title>{data.item.title} · Games · Coast</title></svelte:head>
<MediaDetails {detailHref} view={{hero:!section,item:gameHero({...data.item,id:data.item.externalId},href,false)}} {model} {section}>
  {#if section&&!detailHref}<Button emphasis="subtle" href={href} icon="left">{data.item.title}</Button>{/if}
  {#snippet heroActions()}
    <Button size="hero" icon="plus" disabled={busy} onclick={add}
      >{busy ? 'Adding…' : 'Add game'}</Button
    >
  {/snippet}

</MediaDetails>
