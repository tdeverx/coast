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
  import { goto } from '$app/navigation';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import { discoverySegments } from '$lib/discovery';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const section = $derived(page.url.searchParams.get('section') ?? (data.selection.surface==='read'?'trending':null));
  const mediums=$derived(data.mediaRows);
  const mediumOptions=$derived(discoverySegments.filter(option=>option.value==='watch'||option.value==='read'&&(mediums.experimentalBooks||mediums.experimentalComics)||option.value==='listen'&&mediums.experimentalMusic||option.value==='play'&&mediums.experimentalGaming));
  function discoverSource(row:DiscoverySection,grid=false):ShelfConfig {
    return {type:'discovery',section:row,layout:grid?'grid':'row',mediums,surface:grid?data.selection.surface:'watch',kind:grid?data.selection.kind:'all',page:grid?data.selection.page:1,initial:grid&&data.selected?data.selected:{items:row==='recent'?data.recent:data.trending.length?data.trending:data.items,failure:data.providerUnavailable?'Some discovery providers are unavailable. Please try again.':''}};
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
    {#key `${section}:${data.selection.surface}:${data.selection.kind}:${data.selection.page}`}<Shelf availability={data.selection.surface!=='read'} source={discoverSource(data.selection.section,true)} />{/key}
  {:else}
    {#if data.providerUnavailable}<div class="notice">
        Discovery is temporarily unavailable. Your saved titles are still here.
      </div>{/if}{#if !featured.length}<Heading variant="page"
        title="Discover"
        description="Find your next story."
      >
      {#snippet filters()}{#if page.data.user && mediumOptions.length>1}<SegmentedControl label="Discovery medium" value="watch" options={mediumOptions} onchange={surface=>goto(surface==='watch'?'/discover':`/discover?${new URLSearchParams({section:'trending',surface})}`)} />{/if}{/snippet}
      </Heading>
      <EmptyState
        title="A wider world of stories."
        description={data.configured
          ? 'New discoveries will appear when the metadata service is available.'
          : mediums.experimentalBooks || mediums.experimentalComics ? 'Choose Read to explore reading titles, or connect TMDB for movie and show discovery.' : 'Connect TMDB to discover trending movies and shows, browse new releases, and bring their details into Coast.'}
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
