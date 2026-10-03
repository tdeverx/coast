<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import type { LibrarySurface } from '$lib/library';
  let { data } = $props();
  setContext('profile-read-only', () => !data.owner);
  const title = $derived(data.username ? `${data.username}’s Collection` : 'Library');
  const missing = $derived(page.url.searchParams.get('missing') === 'true');
  const overviewUrl = $derived(data.collection ? `/library?collection=true${data.username ? `&username=${encodeURIComponent(data.username)}` : ''}` : '/library?collection=false');
  function missingUrl() { const url = new URL(page.url); url.searchParams.set('collection', 'true'); url.searchParams.set('missing', String(!missing)); url.searchParams.delete('missingPage'); return url.pathname + url.search; }
  function missingPageUrl(number: number) { const url = new URL(page.url); url.searchParams.set('missingPage', String(number)); return url.pathname + url.search; }
  function selection(surface: LibrarySurface) {
    if (data.view !== surface && surface !== 'watch') return 'all';
    return surface === 'listen' ? data.filters.kind : data.filters.tracking;
  }
</script>

<svelte:head><title>{title} · Coast</title></svelte:head>
<div class="content page route-content">
  {#if data.view !== 'overview'}<Button href={overviewUrl} emphasis="subtle" icon="left">{title}</Button>
  {:else}<Heading {title}>{#snippet heading()}<h1>{title}</h1>{/snippet}</Heading>{/if}
  {#if data.filters.genre}<div class="row section"><p class="small">Genre: {data.filters.genre}</p><Button href="/library?view=watch&scope=all" emphasis="subtle" icon="close">Clear genre</Button></div>{/if}
  {#key `${data.view}:${data.collection}:${data.username}:${JSON.stringify(data.filters)}`}
    {#each ['watch', 'listen', 'play'] as surface}
      {#if (surface === 'watch' || data.experimentalFeatures) && (data.view === 'overview' || data.view === surface)}
        <Shelf source={{ type: 'library', surface: surface as LibrarySurface, collection: data.collection,
          username: data.username ?? '', layout: data.view === surface ? 'grid' : 'row',
          initial: data.view === surface ? data.content ?? undefined : undefined,
          genre: surface === 'watch' ? data.filters.genre : '', initialSelection: selection(surface as LibrarySurface),
          initialKind: surface === 'watch' ? data.filters.kind as 'all' | 'movie' | 'show' : 'all',
          initialScope: data.filters.scope as 'all' | 'available',
          initialAvailability: data.filters.availability, initialRelationship: data.filters.relationship, initialSource: data.filters.source }} />
      {/if}
    {/each}
  {/key}
  {#if data.owner}<section class="section">
    <Button emphasis="subtle" href={missingUrl()}>{missing ? 'Hide' : 'Show'} missing and uncertain items</Button>
    {#if missing}{#await data.missing}<p class="notice">Loading missing items…</p>{:then demand}{#if demand?.total}
      <ul>{#each demand.items as item}<li><a href={item.href}>{item.neededTitle}</a> · {item.reason} · {item.availability === 'unknown' ? 'Availability uncertain' : 'Missing for you'}{item.dateUnknown ? ' · Release date unknown' : ''}</li>{/each}</ul>
      <Pagination page={demand.page} pages={demand.pages} pageUrl={missingPageUrl} label="Missing demand pages" />
    {:else}<p class="notice">No missing or uncertain items.</p>{/if}{:catch}<p class="notice error" role="alert">Missing demand could not be loaded.</p>{/await}{/if}
  </section>{/if}
</div>
<style>h1 { font-size: var(--text-xl); font-weight: var(--weight-bold); margin: 0; }</style>
