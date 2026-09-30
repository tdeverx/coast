<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import BrowseHeader from '$lib/ui/components/BrowseHeader.svelte';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  function pageUrl(page: number, kind = data.filters.kind) {
    return `/music?${new URLSearchParams({
      connection: data.connectionId,
      kind,
      search: data.filters.search,
      page: String(page),
    })}`;
  }
</script>

<svelte:head><title>Music · Coast</title></svelte:head>
<div class="content page route-content">
  <BrowseHeader surface="listen" enabled={data.experimentalFeatures}>
    {#snippet filters()}<RowFilter
        label="Music type"
        value={data.filters.kind}
        options={[
          { value: 'all', label: 'All' },
          { value: 'album', label: 'Albums' },
          { value: 'artist', label: 'Artists' },
          { value: 'track', label: 'Tracks' },
        ]}
        onchange={(kind) =>
          goto(pageUrl(1, kind as typeof data.filters.kind), { keepFocus: true, noScroll: true })}
      />{/snippet}
  </BrowseHeader>
  <form class="filter-row browse-search" action="/music" method="GET">
    <input type="hidden" name="kind" value={data.filters.kind} />
    <input type="hidden" name="connection" value={data.connectionId} />
    <input
      aria-label="Search music"
      name="search"
      type="search"
      placeholder="Search music"
      value={data.filters.search}
      maxlength="200"
    />
    <Button type="submit" variant="secondary" icon="search">Search</Button>
  </form>
  {#if data.failure}
    <div class="notice error" role="alert">{data.failure}</div>
    <Button variant="secondary" icon="refresh" onclick={() => invalidateAll()}>Try again</Button>
  {/if}
  {#if !data.sources.length}
    <EmptyState
      title="Connect your music library"
      description="Link a Jellyfin account to browse its music."
      icon="library"
    >
      <Button variant="secondary" href="/settings/connections">Connect a media server</Button>
    </EmptyState>
  {:else if data.items.length}
    <div class="spread" style="margin-bottom:22px">
      <p class="small">
        {data.total}
        {data.filters.kind === 'all'
          ? 'music items'
          : data.filters.kind === 'artist'
            ? 'artists'
            : data.filters.kind === 'album'
              ? 'albums'
              : 'tracks'}
      </p>
    </div>
    <div class="grid">
      {#each data.items as item (item.href)}<MediaCard {item} shape="square" />{/each}
    </div>
    <Pagination page={data.page} pages={data.pages} {pageUrl} label="Music pages" />
  {:else if !data.failure}
    <EmptyState
      title="No matching music"
      description="Try another music type or search."
      icon="library"
    >
      <Button variant="secondary" href={`/music?connection=${data.connectionId}`}
        >Reset filters</Button
      >
    </EmptyState>
  {/if}
</div>

<style>
  .browse-search input[type='search'] {
    flex: 1;
    min-width: min(100%, 200px);
    width: auto;
  }
</style>
