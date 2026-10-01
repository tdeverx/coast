<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { browseHeading } from '$lib/ui/headings';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  function pageUrl(
    page: number,
    view = data.filters.view,
    state = data.filters.state,
    personal = data.filters.personal
  ) {
    return `/games?${new URLSearchParams({ view, state, personal: String(personal), instance: data.instanceId, search: data.filters.search, page: String(page) })}`;
  }
</script>

<svelte:head><title>Games · Coast</title></svelte:head>
<div class="content page route-content">
  <Heading {...browseHeading("play", data.experimentalFeatures)}>{#snippet actions()}<RowFilter
        label="Games view"
        value={data.filters.view === 'library' && data.filters.personal
          ? 'personal'
          : data.filters.view}
        options={[
          { value: 'library', label: 'All games' },
          { value: 'personal', label: 'Your games' },
          { value: 'igdb', label: 'Discover' },
        ]}
        onchange={(view) =>
          goto(
            pageUrl(
              1,
              view === 'igdb' ? 'igdb' : 'library',
              data.filters.state,
              view === 'personal'
            ),
            { keepFocus: true, noScroll: true }
          )}
      />{#if data.filters.view === 'library'}<RowFilter
          label="Play state"
          value={data.filters.state}
          options={[
            { value: 'all', label: 'All states' },
            { value: 'planned', label: 'Planned' },
            { value: 'in-progress', label: 'In progress' },
            { value: 'paused', label: 'Paused' },
            { value: 'completed', label: 'Completed' },
            { value: 'dropped', label: 'Dropped' },
          ]}
          onchange={(state) =>
            goto(pageUrl(1, data.filters.view, state as typeof data.filters.state), {
              noScroll: true,
              keepFocus: true,
            })}
        />{/if}{#if page.data.user?.role === 'admin'}<Button
          variant="ghost"
          href="/settings/integrations"
          icon="server">Integrations</Button
        >{/if}{/snippet}</Heading>
  <form class="filter-row browse-search" action="/games" method="GET">
    <input type="hidden" name="view" value={data.filters.view} />
    <input type="hidden" name="personal" value={String(data.filters.personal)} />
    <input type="hidden" name="state" value={data.filters.state} />
    <input type="hidden" name="instance" value={data.instanceId} />
    <input
      aria-label="Search games"
      name="search"
      type="search"
      placeholder="Search games"
      value={data.filters.search}
      maxlength="250"
    />
    <Button type="submit" variant="secondary" icon="search">Search</Button>
  </form>
  {#if data.failure}<div class="notice error" role="alert">{data.failure}</div>
    <Button variant="secondary" icon="refresh" onclick={() => invalidateAll()}>Try again</Button>
  {:else if data.items.length}
    <p class="small" style="margin-bottom:22px">
      {data.total}
      {data.filters.view === 'igdb' ? 'results on this page' : data.total === 1 ? 'game' : 'games'}
    </p>
    <div class="grid">
      {#each data.items as item (item.id)}<MediaCard {item} shape="poster" />{/each}
    </div>
    <Pagination page={data.page} pages={data.pages} {pageUrl} label="Games pages" />
  {:else if data.filters.view === 'igdb' && !data.sources.length}
    <EmptyState
      title="Connect IGDB"
      description="An administrator can add IGDB in Integrations to enable game discovery."
      icon="library"
    >
      {#if page.data.user?.role === 'admin'}<Button
          variant="secondary"
          href="/settings/integrations">Configure IGDB</Button
        >{/if}
    </EmptyState>
  {:else if data.filters.view === 'igdb' && !data.filters.search}
    <EmptyState
      title="Find your next game"
      description="Search IGDB to find games and add them to your library."
      icon="search"
    />
  {:else}
    <EmptyState
      title={data.filters.search || data.filters.state !== 'all'
        ? 'No matching games'
        : data.filters.personal
          ? 'No playthroughs yet'
          : 'No games yet'}
      description="Discover games with IGDB and add them to start tracking."
      icon="library"
    >
      <Button variant="secondary" href="/games?view=igdb">Discover games</Button>
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
