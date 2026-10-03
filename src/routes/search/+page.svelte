<script lang="ts">
  import { page } from '$app/state';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { untrack, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  let { data } = $props();
  let watch = $state<Awaited<typeof data.watch> | null>(null),
    listen = $state<Awaited<typeof data.listen> | null>(null),
    play = $state<Awaited<typeof data.play> | null>(null);
  let query = $state(untrack(() => data.query)),
    submitted = untrack(() => data.query);
  const watchResults = $derived(watch ?? data.initial);
  const playItems = $derived(play ? [...play.items, ...play.discover] : []);
  const busy = $derived(!!data.query && (!watch || !listen || !play));
  const noResults = $derived(
    !busy &&
      !watchResults.items.length &&
      !listen?.items.length &&
      !playItems.length &&
      !listen?.failure &&
      !play?.failure
  );
  $effect(() => {
    const watchPending = data.watch,
      listenPending = data.listen,
      playPending = data.play;
    watch = null;
    listen = null;
    play = null;
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
    {#snippet actions()}{#if page.data.user && data.view !== 'all'}<Button
          emphasis="subtle"
          icon="left"
          href={'/search?' + new URLSearchParams({ q: data.query })}>All results</Button
        >{/if}{/snippet}
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
      description={data.experimentalFeatures
        ? 'Search movies, shows, music and games together.'
        : 'Search movies and shows in your library and beyond.'}
      icon="search"
    />
  {:else}
    {#if watchResults.providerUnavailable}<div class="notice">
        Global screen search is temporarily unavailable. Showing your local catalogue.
      </div>{/if}
    {#if noResults}<EmptyState
        title="No matching results"
        description="Try another title, artist or game."
        icon="search"
      />{/if}
    {#key `${data.query}:${data.view}`}
      {#if ['all', 'watch'].includes(data.view) && (!watch || watchResults.items.length || (data.view === 'watch' && !noResults))}
        <Shelf availability={!!page.data.user} source={{ type: 'search', surface: "watch", query: data.query, items: watchResults.items, busy: !watch, truncated: watchResults.truncated, layout: data.view === 'all' ? 'row' : 'grid' }} />
      {/if}
      {#if data.experimentalFeatures && ['all', 'listen'].includes(data.view) && (!listen || listen.items.length || listen.failure)}
        <Shelf source={{ type: 'search', surface: "listen", query: data.query, items: listen?.items ?? [], busy: !listen, failure: listen?.failure, truncated: listen?.truncated, layout: data.view === 'all' ? 'row' : 'grid' }} />
      {/if}
      {#if data.experimentalFeatures && ['all', 'play'].includes(data.view) && (!play || playItems.length || play.failure)}
        <Shelf source={{ type: 'search', surface: "play", query: data.query, items: playItems, busy: !play, failure: play?.failure, truncated: play?.truncated, layout: data.view === 'all' ? 'row' : 'grid' }} />
      {/if}
    {/key}
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
