<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/ui/components/PageHeader.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import MediaTypePicker from '$lib/ui/components/MediaTypePicker.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  let { data } = $props();
  let enriched = $state<Awaited<typeof data.enhancement> | null>(null);
  let kind = $state<'all' | 'movie' | 'show'>('all');
  const results = $derived(enriched ?? data);
  const items = $derived(results.items.filter((item) => kind === 'all' || item.kind === kind));
  const busy = $derived(!!data.query && !enriched);
  const available = $derived(items.filter((item) => item.available));
  const other = $derived(items.filter((item) => !item.available));
  let query = $state(untrack(() => data.query));
  let submitted = untrack(() => data.query);
  $effect(() => {
    const pending = data.enhancement;
    enriched = null;
    let current = true;
    void pending.then((result) => {
      if (current) enriched = result;
    });
    return () => {
      current = false;
    };
  });
  $effect(() => {
    const next = data.query;
    untrack(() => {
      if (query === submitted) {
        query = next;
        submitted = next;
      }
    });
  });
  let timer: ReturnType<typeof setTimeout>;
  function submit() {
    clearTimeout(timer);
    submitted = query;
    void goto(`/search?q=${encodeURIComponent(query.trim())}`, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  }
  onDestroy(() => clearTimeout(timer));
</script>

<svelte:head><title>Search · Coast</title></svelte:head>
<div class="content page route-content" aria-busy={busy}>
  <PageHeader title="Search" description="Find movies and shows in your library and beyond.">
    {#snippet actions()}{#if data.experimentalFeatures}<Button variant="ghost" href="/games?view=igdb" icon="search">Search games</Button>{/if}{/snippet}
  </PageHeader>
  <form
    class="filter-row search-controls"
    action="/search"
    method="GET"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <label class="search-input"
      ><Icon name="search" /><input
        type="search"
        name="q"
        aria-label="Search movies and shows"
        placeholder="Search movies and shows"
        autocomplete="off"
        bind:value={query}
        oninput={() => {
          clearTimeout(timer);
          timer = setTimeout(submit, 350);
        }}
      /></label
    >
    <Button variant="secondary" type="submit">Search</Button>
    <MediaTypePicker bind:value={kind} />
  </form>
  {#if results.truncated}<p class="small">
      Showing the first 100 matches. Refine your search to find more.
    </p>{/if}
  {#if results.providerUnavailable}<div class="notice">
      Global search is temporarily unavailable. Showing your local catalogue.
    </div>{/if}
  {#if !data.query}<EmptyState
      title="Find your next title"
      description="Search original or translated titles. Available titles appear first."
      icon="search"
    />
  {:else if !items.length && !busy}<EmptyState
      title="No matching titles"
      description="Try a different title or media type."
      icon="search"
    />
  {:else}<Shelf
      title="In your library"
      items={available}
      availability={false}
      layout="grid"
      {busy}
    /><Shelf
      title={available.length ? 'More to discover' : 'Movies and shows'}
      items={other}
      availability={false}
      layout="grid"
      {busy}
    />{/if}
</div>

<style>
  .search-controls {
    flex-wrap: wrap;
  }
  .search-input {
    display: flex;
    align-items: center;
    position: relative;
    flex: 1;
    min-width: 200px;
  }
  .search-input :global(svg) {
    position: absolute;
    left: 14px;
    color: var(--muted);
    pointer-events: none;
  }
  .search-input input {
    width: 100%;
    padding-left: 42px;
  }
</style>
