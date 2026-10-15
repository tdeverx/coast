<script lang="ts">
  import { rankSearch } from '$lib/search';
  import { page } from '$app/state';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { untrack, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import type { ShelfItem } from '$lib/ui/shelves/types';
  let { data } = $props();
  let watch = $state<Awaited<typeof data.watch> | null>(null),
    listen = $state<Awaited<typeof data.listen> | null>(null),
    play = $state<Awaited<typeof data.play> | null>(null),
    read = $state<Awaited<typeof data.read> | null>(null);
  let query = $state(untrack(() => data.query)),
    submitted = untrack(() => data.query);
  const watchResults = $derived(watch ?? data.initial);
  const readingResults = $derived(read ?? data.readingInitial);
  const playItems = $derived(play ? [...play.items, ...play.discover] : []);
  const searchItems = $derived<ShelfItem[]>(rankSearch([...watchResults.items, ...(listen?.items ?? []), ...playItems, ...readingResults.items], data.query));
  const failures = $derived([listen?.failure, play?.failure, read?.failure].filter(Boolean).join(' '));
  const busy = $derived(!!data.query && (!watch || !listen || !play || !read));
  const noResults = $derived(
    !busy &&
      !watchResults.items.length &&
      !listen?.items.length &&
      !playItems.length &&
      !read?.items.length &&
      !listen?.failure &&
      !play?.failure &&
      !read?.failure &&
      !read?.notice
  );
  $effect(() => {
    const watchPending = data.watch,
      listenPending = data.listen,
      playPending = data.play,
      readPending = data.read;
    watch = null;
    listen = null;
    play = null;
    read = null;
    let current = true;
    void watchPending.then((result) => {
      if (current) watch = result;
    });
    void listenPending.then((result) => {
      if (current) listen = result;
    });
    void playPending.then((result) => {
      if (current) play = result;
    });
    void readPending.then((result) => {
      if (current) read = result;
    });
    return () => {
      current = false;
    };
  });
  $effect(() => {
    const next = data.query;
    untrack(() => {
      if (query.trim() === submitted) {
        query = next;
        submitted = next;
      }
    });
  });
  let timer: ReturnType<typeof setTimeout>;
  function submit() {
    clearTimeout(timer);
    submitted = query.trim();
    // Row filters use shallow routing; preserve the currently displayed URL.
    const parameters = new URLSearchParams(window.location.search);
    parameters.set('q', submitted);
    parameters.delete('page');
    parameters.delete('scope');
    void goto('/search?' + parameters, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  }
  onDestroy(() => clearTimeout(timer));
</script>

<svelte:head><title>Search · Coast</title></svelte:head>
<div class="content page route-content" aria-busy={busy}>
  <Heading title="Search"
    >{#snippet heading()}<h1>Search</h1>{/snippet}


  </Heading>
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
        aria-label={page.data.user ? "Search your library and beyond" : "Search movies and shows"}
        placeholder={page.data.user ? "Search your library and beyond" : "Search movies and shows"}
        autocomplete="off"
        maxlength="200"
        bind:value={query}
        oninput={() => {
          clearTimeout(timer);
          timer = setTimeout(submit, 350);
        }}
      /></label
    >
    <Button  type="submit">Search</Button>
  </form>
  {#if !data.query}<EmptyState
      title="Find your next story"
      description={`Search movies and shows${data.experimentalMusic ? ', music' : ''}${data.experimentalGaming ? ', games' : ''}${page.data.user && data.experimentalBooks ? ', books' : ''}${page.data.user && data.experimentalComics ? ', comics' : ''} in your library and beyond.`}
      icon="search"
    />
  {:else}
    {#if watchResults.providerUnavailable}<div class="notice">
        Global screen search is temporarily unavailable. Showing your local catalogue.
      </div>{/if}
    {#if noResults}<EmptyState
        title="No matching results"
        description={'Try another title, author, artist or game.'}
        icon="search"
      />{/if}
    {#if !noResults}
      {#key `${data.query}:${data.kind}`}
        <Shelf hideEmpty={false} availability={false} source={{
          type: 'search', bucket: 'available', query: data.query, items: searchItems,
          kind: data.kind, busy, mediums: page.data.user ? page.data : {},
        }} />
        <Shelf hideEmpty={false} availability={false} source={{
          type: 'search', bucket: 'unavailable', query: data.query, items: searchItems,
          kind: data.kind, busy, mediums: page.data.user ? page.data : {},
          failure: failures, notice: readingResults.notice,
          truncated: watchResults.truncated || listen?.truncated || play?.truncated || readingResults.truncated,
        }} />
      {/key}
    {/if}
  {/if}
</div>

<style>
  h1 {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin: 0;
  }
  .search-controls {
    flex-wrap: wrap;
  }
  .search-input {
    display: flex;
    align-items: center;
    position: relative;
    flex: 1;
    min-width: min(100%, 200px);
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
