<script lang="ts">
  import type { DiscoverySection } from '$lib/discovery';
  import type { ShelfConfig } from '$lib/ui/shelves';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { isHeroTitle } from '$lib/media/hero';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import {setContext} from 'svelte';
  import { page } from '$app/state';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const section = $derived(page.url.searchParams.get('section'));
  const otherMedia=$derived(!!data.mediaRows.enabled&&!!page.data.user);
  function discoverSource(row:DiscoverySection,grid=false):ShelfConfig {
    return {type:'discovery',section:row,layout:grid?'grid':'row',otherMedia,surface:grid?data.selection.surface:'watch',initial:grid&&data.selected?data.selected:{items:row==='recent'?data.recent:data.trending.length?data.trending:data.items,failure:data.providerUnavailable?'Some discovery providers are unavailable. Please try again.':''}};
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
    <Button href="/discover" emphasis="subtle" icon="left">Discover</Button>
    {#key `${section}:${data.selection.surface}`}<Shelf source={discoverSource(data.selection.section,true)} />{/key}
  {:else}
    {#if data.providerUnavailable}<div class="notice">
        Discovery is temporarily unavailable. Your saved titles are still here.
      </div>{/if}{#if !featured.length}<Heading variant="page"
        title="Discover"
        description="Find your next story."
      />
      <EmptyState
        title="A wider world of stories."
        description={data.configured
          ? 'New discoveries will appear when the metadata service is available.'
          : 'Connect TMDB to discover trending movies and shows, browse new releases, and bring their details into Coast.'}
        icon="discover"
        >{#if page.data.user?.role === 'admin'}<Button href="/settings/integrations"
            >Set up discovery</Button
          >{:else}<Button href="/search" >Search your catalogue</Button
          >{/if}</EmptyState
      >{/if}<Shelf source={discoverSource('trending')} /><Shelf source={discoverSource('recent')} />{#if featured.length}<p
        class="small quiet"
        style="margin-top:50px"
      >
        Metadata provided by TMDB. This product is not endorsed or certified by TMDB.
      </p>{/if}
  {/if}
</div>
