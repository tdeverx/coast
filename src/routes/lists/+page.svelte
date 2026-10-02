<script lang="ts">
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { change, message } from '$lib/ui/client';
  import type { MediaView } from '$lib/ui/types';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  let { data } = $props();
  let create = $state(false),
    playlist = $state(false),
    name = $state(''),
    description = $state(''),
    error = $state(''),
    deleteId = $state('');
  let heroItems = $state<MediaView[]>(untrack(() => data.detail?.items.filter((item):item is MediaView=>!('href' in item)) ?? []));
  let selection = $state('');
  $effect(() => {
    heroItems = data.detail?.items.filter((item):item is MediaView=>!('href' in item)) ?? [];
  });
  const builtins = [
    { id: 'watchlist', name: 'Watchlist' },
    { id: 'favourites', name: 'Favourites' },
  ];
  const title = $derived(
    data.detail?.selected?.name ??
      builtins.find((list) => list.id === data.detail?.view)?.name ??
      'Your lists'
  );
  async function save() {
    error = '';
    try {
      await change('lists', { name, description, playlist });
      create = false;
      name = '';
      description = '';
    } catch (cause) {
      error = message(cause);
    }
  }
</script>

<svelte:head><title>{title} · Coast</title></svelte:head>
<MediaPage hero={!!data.detail} collection={{items:heroItems,selection}} context="home">
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if data.detail}
    <Button href="/lists" variant="ghost" icon="left">Your lists</Button>
    {#if data.detail.selected?.description}<p class="description">
        {data.detail.selected.description}
      </p>{/if}
    {#key data.detail}<Shelf source={{ type: 'list', view: data.detail.view, title: title, layout: "grid", custom: !!data.detail.selected, initial: data.detail, onitems: (items, key) => {
          heroItems = items;
          selection = key;
        }, ondelete: () => (deleteId = data.detail!.selected!.id) }} />{/key}
  {:else}
    <Heading variant="page" title="Your lists">
      {#snippet actions()}<Button icon="plus" onclick={() => (create = true)}>Create list</Button
        >{/snippet}
    </Heading>
    {#each [...builtins, ...data.lists] as list (list.id)}
      {#key data}<Shelf source={{ type: 'list', view: list.id, title: list.name, custom: !builtins.some((builtin) => builtin.id === list.id) }} />{/key}
    {/each}
  {/if}
</MediaPage>
<Dialog bind:open={create} title="Create a list">
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    {#if error}<p role="alert">{error}</p>{/if}
    <label class="field"
      >Type<select bind:value={playlist}
        ><option value={false}>List</option><option value={true}>Playlist · ordered playback</option
        ></select
      ></label
    >
    <label class="field"
      >List name<input
        bind:value={name}
        required
        maxlength="120"
        placeholder="Sunday evenings"
      /></label
    >
    <label class="field"
      >Description<textarea bind:value={description} rows="3" maxlength="2000"></textarea></label
    >
    <Button type="submit">Create list</Button>
  </form>
</Dialog>
<Dialog onclose={() => (deleteId = '')} open={!!deleteId} title="Delete this list?">
  <div class="stack">
    <p>The list will be removed. Your titles and watch history will stay in Coast.</p>
    <div class="row">
      <Button
        variant="danger"
        onclick={async () => {
          try {
            await change(`lists/${deleteId}`, {}, 'DELETE');
            deleteId = '';
            await goto('/lists', { invalidateAll: true });
          } catch (cause) {
            error = message(cause);
            deleteId = '';
          }
        }}>Delete list</Button
      >
      <Button variant="secondary" onclick={() => (deleteId = '')}>Cancel</Button>
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
