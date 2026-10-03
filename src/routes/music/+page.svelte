<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { browseHeading } from '$lib/ui/headings';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import { librarySelections } from '$lib/library';
  import { availabilityControl } from '$lib/ui/controls/actions';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  function pageUrl(page: number, kind = data.filters.kind, scope = data.filters.scope) {
    return `/music?${new URLSearchParams({
      connection: data.connectionId,
      kind,
      scope,
      search: data.filters.search,
      page: String(page),
    })}`;
  }
</script>

<svelte:head><title>Music · Coast</title></svelte:head>
<div class="content page route-content">
  <Heading {...browseHeading("listen", data.experimentalFeatures)}>{#snippet filters()}<SegmentedControl label="Listen type" value={data.filters.kind} options={librarySelections.listen} onchange={kind => goto(pageUrl(1,kind as typeof data.filters.kind),{keepFocus:true,noScroll:true})} /><Button {...availabilityControl(data.filters.scope === 'available', value => goto(pageUrl(1,data.filters.kind,value?'available':'all'),{keepFocus:true,noScroll:true}))} />{/snippet}</Heading>
  <form class="filter-row browse-search" action="/music" method="GET">
    <input type="hidden" name="kind" value={data.filters.kind} />
    <input type="hidden" name="scope" value={data.filters.scope} />
    <input type="hidden" name="connection" value={data.connectionId} />
    <input
      aria-label="Search music"
      name="search"
      type="search"
      placeholder="Search music"
      value={data.filters.search}
      maxlength="200"
    />
    <Button type="submit"  icon="search">Search</Button>
  </form>
  {#if data.failure}
    <div class="notice error" role="alert">{data.failure}</div>
    <Button  icon="refresh" onclick={() => invalidateAll()}>Try again</Button>
  {/if}
  {#if !data.sources.length}
    <EmptyState
      title="Connect your music library"
      description="Link a Jellyfin account to browse its music."
      icon="library"
    >
      <Button  href="/settings/connections">Connect a media server</Button>
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
      <Button  href={`/music?connection=${data.connectionId}`}
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
