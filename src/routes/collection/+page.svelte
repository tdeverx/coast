<script lang="ts">
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { setContext } from 'svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import { page } from '$app/state';
  let { data } = $props();
  let missing = $state(false);
  function missingPageUrl(number:number){const url=new URL(page.url);url.searchParams.set('missingPage',String(number));return url.pathname+url.search;}
  setContext('profile-read-only', () => !data.owner);
  const title = $derived(data.username ? `${data.username}’s Collection` : 'Collection');
  const watchSelection = $derived(data.filters.activity === 'active' ? 'progress' : data.filters.activity === 'completed' ? 'watched' : data.filters.activity);
</script>

<svelte:head><title>{title} · Coast</title></svelte:head>
<div class="content page route-content">
  {#if data.view !== 'overview'}<Button href={data.username ? `/collection?username=${encodeURIComponent(data.username)}` : '/collection'} variant="ghost" icon="left">{title}</Button>
  {:else}<Heading {title}>{#snippet heading()}<h1>{title}</h1>{/snippet}</Heading>{/if}
  {#key `${data.view}:${data.username}:${JSON.stringify(data.filters)}`}
    {#if data.view === 'overview' || data.view === 'watch'}
      <Shelf source={{ type: 'library', surface: "watch", collection: true, username: data.username ?? '', layout: data.view === 'watch' ? 'grid' : 'row', initial: data.content ?? undefined, initialSelection: watchSelection, initialKind: data.filters.kind as 'all'|'movie'|'show', initialScope: data.filters.availability === 'available' ? 'available' : 'all', initialAvailability: data.filters.availability, initialRelationship: data.filters.relationship, initialSource: data.filters.source }} />
    {/if}
    {#if data.experimentalFeatures && (data.view === 'overview' || data.view === 'listen')}
      <Shelf source={{ type: 'library', surface: "listen", collection: true, username: data.username ?? '', layout: data.view === 'listen' ? 'grid' : 'row', initial: data.view === 'listen' ? data.content ?? undefined : undefined, initialSelection: data.view === 'listen' ? data.filters.kind : 'all', initialScope: "all", initialAvailability: data.view === 'listen' ? data.filters.availability : 'all', initialRelationship: data.view === 'listen' ? data.filters.relationship : 'all', initialSource: data.view === 'listen' ? data.filters.source : 'all' }} />
    {/if}
    {#if data.experimentalFeatures && (data.view === 'overview' || data.view === 'play')}
      <Shelf source={{ type: 'library', surface: "play", collection: true, username: data.username ?? '', layout: data.view === 'play' ? 'grid' : 'row', initial: data.view === 'play' ? data.content ?? undefined : undefined, initialSelection: data.view === 'play' ? data.filters.activity === 'active' ? 'in-progress' : data.filters.activity : 'all', initialScope: "all", initialAvailability: data.view === 'play' ? data.filters.availability : 'all', initialRelationship: data.view === 'play' ? data.filters.relationship : 'all', initialSource: data.view === 'play' ? data.filters.source : 'all' }} />
    {/if}
  {/key}
  {#await data.missing then demand}{#if demand?.total}<section class="section">
    <Button variant="ghost" onclick={() => missing = !missing}>{missing ? 'Hide' : 'Show'} missing and uncertain items ({demand.total})</Button>
    {#if missing}<ul>{#each demand.items as item}<li><a href={item.href}>{item.neededTitle}</a> · {item.reason} · {item.availability === 'unknown' ? 'Availability uncertain' : 'Missing for you'}{item.dateUnknown ? ' · Release date unknown' : ''}</li>{/each}</ul><Pagination page={demand.page} pages={demand.pages} pageUrl={missingPageUrl} label="Missing demand pages" />{/if}
  </section>{/if}{:catch}<p class="notice error" role="alert">Missing demand could not be loaded.</p>{/await}
</div>

<style>
  h1 { font-size: var(--text-xl); font-weight: var(--weight-bold); margin: 0; }
</style>
