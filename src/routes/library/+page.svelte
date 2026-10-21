<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { surfaceEnabled } from '#lib/experimental.js';
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import {libraryTypeOptions} from '#lib/library.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  import type { LibrarySurface } from '#lib/library.js';
  let { data } = $props();
  setContext('profile-read-only', () => !data.owner);
  const title = $derived(data.username ? `${data.username}’s Collection` : 'Library');
  const types=$derived(libraryTypeOptions({...page.data,features:page.data.capabilities}));
  const selectedType=$derived(types.find(type=>type.surface===data.view&&(type.surface!=='watch'&&type.surface!=='read'||type.kind===data.filters.kind)));
  const typeTitle=$derived(selectedType?.label??(data.view==='watch'?'Movies & Shows':data.view==='read'?'Books & Comics':'Library'));
  function typeHref(type:typeof types[number]){
    const params=new URLSearchParams({view:type.surface,kind:type.kind,collection:String(data.collection),scope:data.filters.scope,sort:data.filters.sort,...(data.username?{username:data.username}:{})});
    return '/library?'+params;
  }
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
        initialKind:data.filters.kind as 'all'|'movie'|'show'|'book'|'comic',initialScope:data.filters.scope as 'all'|'available',
        initialSort:data.filters.sort,initialSegment:data.filters.segment,segments:true,initialAvailability:data.filters.availability,initialRelationship:data.filters.relationship,initialSource:data.filters.source,kindControl:false}}>
        {#snippet heading()}<h1><Button menu align="start" triggerClass="library-type" label="Library type">
          {#snippet trigger()}<span>{typeTitle}</span><span class="type-chevron"><Icon name="right" /></span>{/snippet}
          {#each types as type}<Button item href={typeHref(type)} selection="radio" checked={selectedType?.value===type.value}>{type.label}</Button>{/each}
        </Button></h1>{/snippet}
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
<style>h1 {font-size:var(--text-xl);font-weight:var(--weight-bold);margin:0;}h1 :global(.library-type){display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;}.type-chevron{display:inline-flex;transform:rotate(90deg);opacity:.6;}</style>
