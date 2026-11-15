<script lang="ts">
  import MediaCard from '#lib/ui/components/MediaCard.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import { reportFailure } from '#lib/ui/client-context.js';
  import { surfaceEnabled } from '#lib/experimental.js';
  import { goto } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { notifyAction } from '#lib/ui/action-feedback.svelte.js';
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  import type { LibrarySurface } from '#lib/library.js';
  let { data,form } = $props();
  let reconnecting=$state(false);
  reportFailure(()=>form?.error);
  setContext('profile-read-only', () => !!data.scoped || !data.owner);
  const title = $derived('username' in data && data.username ? `${data.username}’s Collection` : 'Library');
  const missing = $derived(page.url.searchParams.get('missing') === 'true');
  function missingUrl() { const url = new URL(page.url.href); url.searchParams.set('collection', 'true'); url.searchParams.set('missing', String(!missing)); url.searchParams.delete('missingPage'); return url.pathname + url.search; }
  function missingPageUrl(number: number) { const url = new URL(page.url.href); url.searchParams.set('missingPage', String(number)); return url.pathname + url.search; }
  function selection(surface: LibrarySurface) {
    if (data.scoped || data.view !== surface && surface !== 'watch') return 'all';
    return surface === 'listen' ? data.filters.kind : data.filters.tracking;
  }
  let demandError=$state('');
  $effect(()=>{const pending=data.scoped?null:data.missing;demandError='';let current=true;void pending?.catch(()=>{if(current)demandError='Missing demand could not be loaded.';});return()=>{current=false;};});
  reportFailure(()=>missing ? demandError : '');
</script>

<svelte:head><title>{title} · Coast</title></svelte:head>
<div class="content page route-content">
{#if data.scoped}
  <h1>Library</h1>
  <form action="/library" class="row">
    {#if data.scoped.continueOnly}<input type="hidden" name="view" value="continue" />{/if}
    <label class="field">Search your library<input type="search" name="q" maxlength="100" value={data.scoped.query} /></label>
    <Button type="submit">Search</Button>
    <Button href={data.scoped.continueOnly ? '/library' : '/library?view=continue'} emphasis="subtle">{data.scoped.continueOnly ? 'All titles' : 'Continue'}</Button>
  </form>
  {#if data.scoped.items.length}
    <div class="media-grid">
      {#each data.scoped.items as item (item.id)}
        <MediaCard {item} showPrimaryAction={false} onselect={() => void goto('/media/'+item.id)} />
      {/each}
    </div>
    {#if data.scoped.next}
      <Button href={'/library?'+new URLSearchParams({after:data.scoped.next,q:data.scoped.query,...data.scoped.continueOnly?{view:'continue'}:{}})}>Next page</Button>
    {/if}
  {:else}
    <EmptyState title="No titles to show" description="Titles appear here as your assigned library is verified." icon="library" />
    <details><summary>Reconnect Jellyfin</summary>
      <form class="row" method="POST" action="?/reconnect" use:enhance={()=>{
        reconnecting=true;
        return async({result,update})=>{try{await update();if(result.type==='success')notifyAction('Jellyfin reconnected.');}finally{reconnecting=false;}};
      }}>
        <label class="field">Jellyfin password<input type="password" name="password" autocomplete="current-password" required /></label>
        <Button type="submit" disabled={reconnecting}>Reconnect</Button>
      </form>
    </details>
  {/if}
{:else}
  {#key `${data.view}:${data.collection}:${data.username}:${JSON.stringify(data.filters)}`}
    {#if surfaceEnabled({...data,features:page.data.capabilities},data.view)}
      <Shelf source={{type:'library',surface:data.view as LibrarySurface,collection:data.collection,
        username:data.username??'',layout:'grid',initial:data.content??undefined,
        onboarding:!data.username ? {importStatus:data.importStatus} : undefined,
        genre:data.filters.genre,initialSelection:selection(data.view as LibrarySurface),
        initialKind:data.filters.kind as import('#lib/library.js').LibraryKind,initialScope:data.filters.scope as 'all'|'available',
        initialSort:data.filters.sort,initialSegment:data.filters.segment,segments:true,initialAvailability:data.filters.availability,initialRelationship:data.filters.relationship,initialSource:data.filters.source,kindControl:false,entitySegments:true,countHeading:true}}>
      </Shelf>
    {/if}
  {/key}
  {#if data.owner && data.view !== 'read'}<section class="section">
    <Button emphasis="subtle" href={missingUrl()}>{missing ? 'Hide' : 'Show'} missing and uncertain items</Button>
    {#if missing}{#await data.missing}<p class="small" role="status">Loading missing items…</p>{:then demand}{#if demand?.total}
      <ul>{#each demand.items as item}<li><a href={item.href}>{item.neededTitle}</a> · {item.reason} · {item.availability === 'unknown' ? 'Availability uncertain' : 'Missing for you'}{item.dateUnknown ? ' · Release date unknown' : ''}</li>{/each}</ul>
      <Pagination page={demand.page} pages={demand.pages} pageUrl={missingPageUrl} label="Missing demand pages" />
    {:else}<p class="small" role="status">No missing or uncertain items.</p>{/if}{:catch}<!-- Failure is delivered by the scoped toast. -->{/await}{/if}
  </section>{/if}
{/if}
</div>

<style>
  .media-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--row-card-width, 160px)),1fr)); gap:var(--gutter); }
</style>
