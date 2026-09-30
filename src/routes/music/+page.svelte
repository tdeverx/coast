<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import PageHeader from '$lib/ui/components/PageHeader.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import { musicCard } from '$lib/music/presentation';
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
  <PageHeader title="Music" description="Browse music from your Jellyfin library.">
    {#snippet actions()}
      <Button variant="ghost" href="/library" icon="film">Movies and shows</Button>
      <Button variant="ghost" href="/settings/connections" icon="server">Connections</Button>
    {/snippet}
  </PageHeader>
  <form class="filter-row" action="/music" method="GET">
    <SegmentedControl
      label="Music type"
      value={data.filters.kind}
      options={[
        { value: 'album', label: 'Albums' },
        { value: 'artist', label: 'Artists' },
        { value: 'track', label: 'Tracks' },
      ]}
      onchange={(kind) =>
        goto(pageUrl(1, kind as typeof data.filters.kind), {
          keepFocus: true,
          noScroll: true,
        })}
    />
    <input type="hidden" name="kind" value={data.filters.kind} />
    <div style="flex:1"></div>
    {#if data.sources.length}
      <select
        aria-label="Music source"
        name="connection"
        value={data.connectionId}
        onchange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {#each data.sources as source}<option value={source.id}>{source.name}</option>{/each}
      </select>
    {/if}
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
  {:else if !data.sources.length}
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
        {data.filters.kind === 'artist'
          ? 'artists'
          : data.filters.kind === 'album'
            ? 'albums'
            : 'tracks'}
      </p>
    </div>
    <div class="grid">
      {#each data.items as item (item.id)}<MediaCard
          item={musicCard(item, data.connectionId)}
          shape="square"
        />{/each}
    </div>
    <Pagination page={data.page} pages={data.pages} {pageUrl} label="Music pages" />
  {:else}
    <EmptyState
      title="No matching music"
      description="Try another music type, source or search."
      icon="library"
    >
      <Button variant="secondary" href={`/music?connection=${data.connectionId}`}
        >Reset filters</Button
      >
    </EmptyState>
  {/if}
</div>
