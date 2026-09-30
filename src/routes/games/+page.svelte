<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import PageHeader from '$lib/ui/components/PageHeader.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  function pageUrl(page: number, view = data.filters.view) {
    return `/games?${new URLSearchParams({ view, instance: data.instanceId, search: data.filters.search, page: String(page) })}`;
  }
</script>
<svelte:head><title>Games · Coast</title></svelte:head>
<div class="content page route-content">
  <PageHeader title="Games" description="Browse games and track your playthroughs.">
    {#snippet actions()}
      <Button variant="ghost" href="/library" icon="left">Library</Button>
      {#if page.data.user?.role === 'admin'}<Button variant="ghost" href="/settings/integrations" icon="server">Integrations</Button>{/if}
    {/snippet}
  </PageHeader>
  <form class="filter-row" action="/games" method="GET">
    <SegmentedControl label="Games view" value={data.filters.view} options={[{ value: 'library', label: 'Library' }, { value: 'igdb', label: 'Discover' }]}
      onchange={(view) => goto(pageUrl(1, view as typeof data.filters.view), { keepFocus: true, noScroll: true })} />
    <input type="hidden" name="view" value={data.filters.view} />
    <div style="flex:1"></div>
    {#if data.filters.view === 'igdb' && data.sources.length}
      <select aria-label="Game metadata source" name="instance" value={data.instanceId} onchange={(event) => event.currentTarget.form?.requestSubmit()}>
        {#each data.sources as source}<option value={source.id}>{source.name}</option>{/each}
      </select>
    {/if}
    <input aria-label="Search games" name="search" type="search" placeholder="Search games" value={data.filters.search} maxlength="250" />
    <Button type="submit" variant="secondary" icon="search">Search</Button>
  </form>
  {#if data.failure}<div class="notice error" role="alert">{data.failure}</div>
    <Button variant="secondary" icon="refresh" onclick={() => invalidateAll()}>Try again</Button>
  {:else if data.items.length}
    <p class="small" style="margin-bottom:22px">{data.total} {data.filters.view === 'igdb' ? 'results on this page' : data.total === 1 ? 'game' : 'games'}</p>
    <div class="grid">{#each data.items as item (item.id)}<MediaCard {item} shape="square" />{/each}</div>
    <Pagination page={data.page} pages={data.pages} {pageUrl} label="Games pages" />
  {:else if data.filters.view === 'igdb' && !data.sources.length}
    <EmptyState title="Connect IGDB" description="An administrator can add IGDB in Integrations to enable game discovery." icon="library">
      {#if page.data.user?.role === 'admin'}<Button variant="secondary" href="/settings/integrations">Configure IGDB</Button>{/if}
    </EmptyState>
  {:else if data.filters.view === 'igdb' && !data.filters.search}
    <EmptyState title="Find your next game" description="Search IGDB to find games and add them to your library." icon="search" />
  {:else}
    <EmptyState title={data.filters.search ? 'No matching games' : 'No games yet'} description="Discover games with IGDB and add them to start tracking." icon="library">
      <Button variant="secondary" href="/games?view=igdb">Discover games</Button>
    </EmptyState>
  {/if}
</div>
