<script lang="ts">
  import type { DiscoverySection } from '#lib/discovery.js';
  import type { ShelfConfig } from '#lib/ui/shelves/index.js';
  import Heading from '#lib/ui/components/Heading.svelte';
  import { isHeroTitle } from '#lib/media/hero.js';
  import MediaHero from '#lib/ui/components/MediaHero.svelte';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import {setContext} from 'svelte';
  import { page } from '$app/state';

  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const section = $derived(page.url.searchParams.get('section'));
  const mediums=$derived({...data.mediaRows,features:page.data.capabilities});
  function discoverSource(row:DiscoverySection,grid=false):ShelfConfig {
    return {type:'discovery',section:row,layout:grid?'grid':'row',mediums,surface:data.selection.surface,scoped:true,kind:grid?data.selection.kind:'all',page:grid?data.selection.page:1,initial:grid&&data.selected?data.selected:data.selection.surface!=='watch'?undefined:{items:row==='recent'?data.recent:data.trending.length?data.trending:data.items,failure:data.providerUnavailable?'Some discovery providers are unavailable. Please try again.':''}};
  }
  const featured = $derived(
    (data.trending.length ? data.trending : data.items).filter(isHeroTitle).slice(0, 5)
  );
</script>

<svelte:head><title>Discover · Coast</title></svelte:head
>{#if featured.length && !section}<MediaHero
    item={featured[0]}
    items={featured}
    context="discover"
  />{/if}
<div class="content" class:page={!featured.length || !!section} style="padding-bottom:90px">
  {#if section}
    <Button href={`/discover?view=${data.selection.surface}`} emphasis="subtle" icon="left">Discover</Button>
    {#key `${section}:${data.selection.surface}:${data.selection.kind}:${data.selection.page}`}<Shelf availability={data.selection.surface!=='read'} source={discoverSource(data.selection.section,true)} />{/key}
  {:else}
    {#if !featured.length}<Heading variant="page" title="Discover" />
      {#if data.selection.surface==='watch'}<EmptyState
        title="A wider world of stories."
        description={data.configured
          ? 'New discoveries will appear when the metadata service is available.'
          : mediums.experimentalBooks || mediums.experimentalComics ? 'Choose Read to explore reading titles, or connect TMDB for movie and show discovery.' : 'Connect TMDB to discover trending movies and shows, browse new releases, and bring their details into Coast.'}
        icon="discover"
        >{#if page.data.user?.role === 'admin'}<Button href="/settings/integrations"
            >Set up discovery</Button
          >{:else}<Button href="/search" >Search your catalogue</Button
          >{/if}</EmptyState
      >{/if}{/if}{#key `${data.selection.surface}:${page.data.user?.id}`}<Shelf source={discoverSource('trending')} hideEmpty={false}/><Shelf source={discoverSource('recent')} hideEmpty={false}/>{/key}{#if featured.length}<p
        class="small quiet"
        style="margin-top:50px"
      >
        Metadata provided by TMDB. This product is not endorsed or certified by TMDB.
      </p>{/if}
  {/if}
</div>
