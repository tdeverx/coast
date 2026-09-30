<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import RowHeader from '$lib/ui/components/RowHeader.svelte';
  import SearchShelf from '$lib/ui/components/SearchShelf.svelte';
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
    void goto('/search?' + new URLSearchParams({ q: submitted }), {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  }
  onDestroy(() => clearTimeout(timer));
</script>

<svelte:head><title>Search · Coast</title></svelte:head>
<div class="content page route-content" aria-busy={busy}>
  <RowHeader title="Search"
    >{#snippet heading()}<h1>Search</h1>{/snippet}
    {#snippet actions()}{#if data.view !== 'all'}<Button
          variant="ghost"
          icon="left"
          href={'/search?' + new URLSearchParams({ q: data.query })}>All results</Button
        >{/if}{/snippet}
  </RowHeader>
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
        aria-label="Search your library and beyond"
        placeholder="Search your library and beyond"
        autocomplete="off"
        maxlength="200"
        bind:value={query}
        oninput={() => {
          clearTimeout(timer);
          timer = setTimeout(submit, 350);
        }}
      /></label
    >
    <Button variant="secondary" type="submit">Search</Button>
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
        <SearchShelf
          surface="watch"
          query={data.query}
          items={watchResults.items}
          busy={!watch}
          truncated={watchResults.truncated}
          layout={data.view === 'all' ? 'row' : 'grid'}
        />
      {/if}
      {#if data.experimentalFeatures && ['all', 'listen'].includes(data.view) && (!listen || listen.items.length || listen.failure)}
        <SearchShelf
          surface="listen"
          query={data.query}
          items={listen?.items ?? []}
          busy={!listen}
          failure={listen?.failure}
          truncated={listen?.truncated}
          layout={data.view === 'all' ? 'row' : 'grid'}
        />
      {/if}
      {#if data.experimentalFeatures && ['all', 'play'].includes(data.view) && (!play || playItems.length || play.failure)}
        <SearchShelf
          surface="play"
          query={data.query}
          items={playItems}
          busy={!play}
          failure={play?.failure}
          truncated={play?.truncated}
          layout={data.view === 'all' ? 'row' : 'grid'}
        />
      {/if}
    {/key}
  {/if}
</div>

<style>
  h1 {
    font-size: var(--row-title-size);
    font-weight: var(--row-title-weight);
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
