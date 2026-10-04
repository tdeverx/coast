<script lang="ts">
  import DynamicFeed from '$lib/experiments/DynamicFeed.svelte';
  import { page } from '$app/state';
  import Heading from '$lib/ui/components/Heading.svelte';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { data } = $props();
  const section = $derived(page.url.searchParams.get('section'));
</script>

<svelte:head><title>For You · Coast</title></svelte:head>
{#if data.hero && !section}<MediaHero item={data.hero} next={data.heroNext} context="home" />{/if}
<div class="content" class:page={!data.hero || !!section} style:padding-bottom={!section ? '0px' : '90px'}>
  {#if section}
    <Button href="/for-you" emphasis="subtle" icon="left">For You</Button>
    {#if section === 'upcoming' && page.data.experiments.planning}
      <Shelf source={{type:'experimental',feature:'upcoming',layout:'grid'}} />
    {:else if section === 'recommendations'}
      <Shelf source={{type:'experimental',feature:'recommendations',layout:'grid'}} />
    {:else if section === 'dynamic' && (page.url.searchParams.get('genre') || page.url.searchParams.get('work'))}
      <Shelf source={{type:'experimental',feature:'row',genre:page.url.searchParams.get('genre')??undefined,workId:page.url.searchParams.get('work')??undefined,kind:(['movie','show','game','album'].includes(page.url.searchParams.get('kind')??'')?page.url.searchParams.get('kind'):undefined) as import('$lib/experiments/row-titles').DynamicKind|undefined,reason:(['liked','watched','saved','explore'].includes(page.url.searchParams.get('reason')??'')?page.url.searchParams.get('reason'):undefined) as import('$lib/experiments/row-ranking').GenreReason|undefined,layout:'grid'}} />
    {:else if section === 'popular'}
      <Shelf source={{type:'social',surface:'popular',layout:'grid',mediums:true,category:page.url.searchParams.get('category')??'screen'}} />
    {:else}
      <Shelf source={{type:'social',layout:'grid',mediums:true,category:page.url.searchParams.get('category')??'screen'}} />
    {/if}
  {:else}
    {#if !data.hero}
      <Heading variant="page" title="For You" description="Your stories, all together." />
      <EmptyState
        title="Your next story starts here."
        description="Build a watchlist, remember what you’ve seen, and pick up wherever you left off. Coast keeps it all together."
        icon="home"
        ><div class="row" style="justify-content:center">
          <Button href="/discover">Find something to watch</Button>
        </div></EmptyState
      >
    {/if}
    <Shelf source={{type:'progress',mediums:true}} />
    <Shelf source={{type:'progress',surface:'next',mediums:true}} />
    <Shelf source={{type:'progress',surface:'recommendations',mediums:true}} />
    <Shelf source={{type:'progress',surface:'favourites',mediums:true}} />
    {#if page.data.experiments.planning}<Shelf source={{type:'experimental',feature:'upcoming'}} />{/if}
    <Shelf source={{type:'social',mediums:true}} />
    <DynamicFeed />
  {/if}
</div>
