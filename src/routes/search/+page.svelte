<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { rankSearch } from '#lib/search.js';
  import { page } from '$app/state';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import { untrack, onDestroy, onMount } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import Heading from '#lib/ui/components/Heading.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import type { ShelfItem } from '#lib/ui/shelves/types.js';
  import { searchSelectionUrl, type SearchBucket, type SearchRowSelection } from '#lib/search-selection.js';
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

  const searchItems = $derived<ShelfItem[]>(rankSearch(
    [
      ...watchResults.items,
      ...listen?.items ?? [],
      ...playItems,
      ...readingResults.items
    ],
    data.query
  ));

  const failures = $derived([listen?.failure, play?.failure, read?.failure].filter(Boolean).join(' '));
  function rowBusy(row: SearchRowSelection) {
    return !!data.query && ((row.view === 'all' || row.view === 'watch') && data.demand.watch && !watch ||
      (row.view === 'all' || row.view === 'listen') && data.demand.listen && !listen ||
      (row.view === 'all' || row.view === 'play') && data.demand.play && !play ||
      (row.view === 'all' || row.view === 'read') && data.demand.read && !read);
  }
  const busy = $derived(rowBusy(data.rows.available) || rowBusy(data.rows.unavailable));
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
  let intent: URL | undefined, intentRevision = 0;
  const pendingTargets = new Map<number, string>();
  function clearIntent() {
    intentRevision++;
    intent = undefined;
    pendingTargets.clear();
    clearTimeout(timer);
  }

  beforeNavigate((navigation) => {
    if (navigation.shallow) return;

    // Native history owns this boundary even while Kit skips navigation hooks.
    if (navigation.type === 'popstate') return;
    if (navigation.type === 'goto' && navigation.to && [...pendingTargets.values()].includes(navigation.to.url.href)) return;
    clearIntent();
  });
  onMount(() => {
    const historyTarget = () => {
      clearIntent();
      const target = new URL(window.location.href);
      if (target.origin !== page.url.origin || target.pathname !== page.url.pathname) return;
      intent = target;
      // Back restores the submitted query; an unsent user draft stays editable.
      if (query.trim() === submitted) {
        query = target.searchParams.get('q') ?? '';
        submitted = query.trim();
      }
    };
    window.addEventListener('popstate', historyTarget);
    return () => window.removeEventListener('popstate', historyTarget);
  });
  function submit(row?: { bucket: SearchBucket; kind: string }) {
    clearTimeout(timer);
    submitted = query.trim();
    const target = new URL(searchSelectionUrl(intent ?? page.url, submitted, row), page.url.href);
    const revision = ++intentRevision;
    intent = target;
    pendingTargets.set(revision, target.href);
    const settled = (failed = false) => {
      pendingTargets.delete(revision);
      if (revision === intentRevision) {
        const address = failed ? new URL(window.location.href) : undefined;
        intent = address?.origin === page.url.origin && address.pathname === page.url.pathname ? address : undefined;
      }
    };
    void goto(target.href, {
      reset: false,

      replaceState: !row,
    }).then(() => settled(), () => settled(true));
  }
  onDestroy(clearIntent);
  reportFailure(()=>[watchResults.providerUnavailable ? 'Global screen search is temporarily unavailable. Showing your local catalogue.' : '',failures].filter(Boolean).join(' '));
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

    {#if noResults && !data.filtered}<EmptyState
        title="No matching results"
        description={'Try another title, author, artist or game.'}
        icon="search"
      />{/if}
    {#if !noResults || data.filtered}
      {#key data.query}
        <Shelf
          hideEmpty={false}
          availability={false}
          source={{
            type: 'search',
            bucket: 'available',
            query: data.query,
            items: searchItems,
            ...data.rows.available,
            busy: rowBusy(data.rows.available),
            mediums: page.data.user ? page.data : {},
            onKindChange: (kind) => submit({ bucket: 'available', kind })
          }}
        />

        <Shelf
          hideEmpty={false}
          availability={false}
          source={{
            type: 'search',
            bucket: 'unavailable',
            query: data.query,
            items: searchItems,
            ...data.rows.unavailable,
            busy: rowBusy(data.rows.unavailable),
            mediums: page.data.user ? page.data : {},
            onKindChange: (kind) => submit({ bucket: 'unavailable', kind }),
            notice: readingResults.notice,
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
