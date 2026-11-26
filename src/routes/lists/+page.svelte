<script lang="ts">
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  const {change, preview} = useClient();
  import { message } from '#lib/ui/client.js';
  import type { MediaView } from '#lib/ui/types.js';
  import MediaPage from '#lib/ui/components/MediaPage.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import type { PageData } from './$types';
  let { data }: { data:Pick<PageData,'detail'|'overviewHref'> } = $props();
  let error = $state(''), deleteId = $state('');
  let heroItems = $state<MediaView[]>(untrack(() => data.detail.items.filter((item):item is MediaView=>!('href' in item))));
  let selection = $state('');
  $effect(() => {
    heroItems = data.detail.items.filter((item):item is MediaView=>!('href' in item));
  });
  const builtins = [
    { id: 'watchlist', name: 'Watchlist' },
    { id: 'favourites', name: 'Favourites' },
  ];
  const title = $derived(
    data.detail.selected?.name ??
      builtins.find((list) => list.id === data.detail.view)?.name ??
      'Your lists'
  );
  reportFailure(()=>error);
</script>

<svelte:head><title>{title} · Coast</title></svelte:head>
<MediaPage collection={{items:heroItems,selection}} context="home">
  <Button href={data.overviewHref} emphasis="subtle" icon="left">Your lists</Button>
  {#if data.detail.selected?.description}<p class="description">{data.detail.selected.description}</p>{/if}
  {#key data.detail.view}<Shelf source={{
    type: 'list', view: data.detail.view, title, layout: 'grid', custom: !!data.detail.selected, initial: data.detail,
    onitems: (items, key) => { heroItems = items; selection = key; },
    ondelete: () => { deleteId = data.detail.selected!.id; },
  }} />{/key}
</MediaPage>
<Dialog onclose={() => (deleteId = '')} open={!!deleteId} title="Delete this list?">
  <div class="stack">
    <p>The list will be removed. Your titles and watch history will stay in Coast.</p>
    <div class="row">
      <Button
        danger
        onclick={async () => {
          try {
            await change(`lists/${deleteId}`, {}, 'DELETE');
            deleteId = '';
            if (!preview) await goto(data.overviewHref, { refreshAll: true });
          } catch (cause) {
            error = message(cause);
            deleteId = '';
          }
        }}>Delete list</Button
      >
      <Button  onclick={() => (deleteId = '')}>Cancel</Button>
    </div>
  </div>
</Dialog>

<style>
  .description {
    margin-top: 16px;
    color: var(--muted);
    white-space: pre-wrap;
  }
</style>
