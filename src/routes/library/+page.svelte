<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { surfaceEnabled } from '#lib/experimental.js';
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  import type { LibrarySurface } from '#lib/library.js';
  let { data } = $props();
  setContext('profile-read-only', () => !data.owner);
  const title = $derived(data.username ? `${data.username}’s Collection` : 'Library');
  const missing = $derived(page.url.searchParams.get('missing') === 'true');
  function missingUrl() { const url = new URL(page.url.href); url.searchParams.set('collection', 'true'); url.searchParams.set('missing', String(!missing)); url.searchParams.delete('missingPage'); return url.pathname + url.search; }
  function missingPageUrl(number: number) { const url = new URL(page.url.href); url.searchParams.set('missingPage', String(number)); return url.pathname + url.search; }
  function selection(surface: LibrarySurface) {
    if (data.view !== surface && surface !== 'watch') return 'all';
    return surface === 'listen' ? data.filters.kind : data.filters.tracking;
  }
  let demandError=$state('');
  $effect(()=>{const pending=data.missing;demandError='';let current=true;void pending?.catch(()=>{if(current)demandError='Missing demand could not be loaded.';});return()=>{current=false;};});
  reportFailure(()=>missing ? demandError : '');
</script>

<svelte:head><title>{title} · Coast</title></svelte:head>
<div class="content page route-content">
  {#key `${data.view}:${data.collection}:${data.username}:${JSON.stringify(data.filters)}`}
    {#if surfaceEnabled({...data,features:page.data.capabilities},data.view)}
      <Shelf source={{type:'library',surface:data.view as LibrarySurface,collection:data.collection,
        username:data.username??'',layout:'grid',initial:data.content??undefined,
        genre:data.filters.genre,initialSelection:selection(data.view as LibrarySurface),
        initialKind:data.filters.kind as import('#lib/library.js').LibraryKind,initialScope:data.filters.scope as 'all'|'available',
        initialSort:data.filters.sort,initialSegment:data.filters.segment,segments:true,initialAvailability:data.filters.availability,initialRelationship:data.filters.relationship,initialSource:data.filters.source,kindControl:false,entitySegments:true,countHeading:true}}>
      </Shelf>
    {/if}
  {/key}
  {#if data.owner && data.view !== 'read'}<section class="section">
    <Button emphasis="subtle" href={missingUrl()}>{missing ? 'Hide' : 'Show'} missing and uncertain items</Button>
    {#if missing}{#await data.missing}<p class="notice">Loading missing items…</p>{:then demand}{#if demand?.total}
      <ul>{#each demand.items as item}<li><a href={item.href}>{item.neededTitle}</a> · {item.reason} · {item.availability === 'unknown' ? 'Availability uncertain' : 'Missing for you'}{item.dateUnknown ? ' · Release date unknown' : ''}</li>{/each}</ul>
      <Pagination page={demand.page} pages={demand.pages} pageUrl={missingPageUrl} label="Missing demand pages" />
    {:else}<p class="notice">No missing or uncertain items.</p>{/if}{:catch}<!-- Failure is delivered by the scoped toast. -->{/await}{/if}
  </section>{/if}
</div>
