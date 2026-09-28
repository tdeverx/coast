<script lang="ts">
  import PageHeader from '$lib/ui/components/PageHeader.svelte';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import MediaTypePicker from '$lib/ui/components/MediaTypePicker.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import AddTitle from '$lib/ui/components/AddTitle.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  let kind = $state(untrack(() => data.filters.kind)),
    scope = $state(untrack(() => data.filters.scope)),
    trackingFilter = $state(untrack(() => data.filters.tracking)),
    source = $state(untrack(() => data.filters.source)),
    addOpen = $state(false);
  $effect(() => {
    kind = data.filters.kind;
    scope = data.filters.scope;
    trackingFilter = data.filters.tracking;
    source = data.filters.source;
  });
  const items = $derived(data.items);
  function filter() {
    const query = new URLSearchParams({
      kind,
      scope,
      source,
      tracking: trackingFilter,
      genre: data.filters.genre,
    });
    void goto(`/library?${query}`, { keepFocus: true, noScroll: true, replaceState: true });
  }
  function pageUrl(number: number) {
    return `/library?${new URLSearchParams({ ...data.filters, page: String(number) })}`;
  }
</script>

<svelte:head><title>Library · Coast</title></svelte:head>
<div class="content page route-content">
  <PageHeader
    title={data.filters.genre || 'Library'}
    description={data.filters.genre
      ? `Browse ${data.filters.genre.toLowerCase()} movies and shows.`
      : 'Browse your library and tracked titles.'}
  >
    {#snippet actions()}
      {#if data.filters.genre}<Button href="/library?scope=all" variant="ghost" icon="close"
          >Clear genre</Button
        >{/if}
      <Button variant="ghost" href="/settings/connections" icon="server">Connections</Button>
      <Button variant="secondary" icon="plus" onclick={() => (addOpen = true)}>Add a title</Button>
    {/snippet}
  </PageHeader>
  <div class="filter-row">
    <MediaTypePicker bind:value={kind} onchange={filter} />
    <div style="flex:1"></div>
    <select aria-label="Availability" bind:value={scope} onchange={filter}
      ><option value="available">Available</option><option value="all">All titles</option></select
    ><select aria-label="Media source" bind:value={source} onchange={filter}
      ><option value="all">All sources</option>{#each data.providers as provider}<option
          value={provider.id}>{provider.name}</option
        >{/each}</select
    ><select aria-label="Tracking state" bind:value={trackingFilter} onchange={filter}
      ><option value="all">All states</option><option value="unwatched">Unwatched</option><option
        value="progress">In progress</option
      ><option value="watched">Watched</option><option value="dropped">Dropped</option></select
    >
  </div>
  {#if items.length}<div class="spread" style="margin-bottom:22px">
      <p class="small">{data.total} {data.total === 1 ? 'title' : 'titles'}</p>
    </div>
    <div class="grid">
      {#each items as item (item.id)}<MediaCard {item} />{/each}
    </div>
    <Pagination
      page={data.page}
      pages={data.pages}
      {pageUrl}
      label="Library pages"
    />{:else}<EmptyState
      title="No matching titles"
      description={data.providers.length
        ? 'Try another type, availability or tracking filter.'
        : 'Connect Jellyfin to browse your library, or choose All titles to see titles you track.'}
      icon="library"
      >{#if data.providers.length}<Button
          variant="secondary"
          onclick={() => {
            kind = 'all';
            scope = 'all';
            source = 'all';
            trackingFilter = 'all';
            filter();
          }}>Reset filters</Button
        >
      {:else}<Button href="/settings/connections" variant="secondary">Connect a media server</Button
        >{/if}</EmptyState
    >{/if}
</div>
<AddTitle bind:open={addOpen} />
