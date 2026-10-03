<script lang="ts">
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
<div class="content" class:page={!data.hero || !!section} style="padding-bottom:90px">
  {#if section}
    <Button href="/for-you" emphasis="subtle" icon="left">For You</Button>
    {#if section === 'activity'}<Shelf source={{type:'social',layout:'grid',mediums:true,category:page.url.searchParams.get('category')??'screen'}} />{:else}{#key section}<Shelf
        title={section === 'recent'
          ? 'Recently watched'
          : (data.recommendations?.title ?? 'Recommendations')}
        items={section === 'recent' ? data.recentlyWatched : (data.recommendations?.items ?? [])}
        layout="grid"
      filterBy="type" />{/key}{/if}
  {:else}
    {#if !data.hero}<Heading variant="page" title="For You" description="Your stories, all together.">
      </Heading>
      <EmptyState
        title="Your next story starts here."
        description="Build a watchlist, remember what you’ve seen, and pick up wherever you left off. Coast keeps it all together."
        icon="home"
        ><div class="row" style="justify-content:center">
          <Button href="/discover">Find something to watch</Button>
        </div></EmptyState
      >{/if}<Shelf source={{ type: 'progress', mediums: true, initial: data.progress }} /><Shelf source={{ type: 'progress', surface: "next", mediums: true }} /><Shelf source={{ type: 'progress', surface: "recommendations", mediums: true }} /><Shelf source={{ type: 'progress', surface: "favourites", mediums: true }} /><Shelf
      title="Recently watched"
      href="/for-you?section=recent"
      items={data.recentlyWatched}
      shape="fanart"
    filterBy="type" />{#if data.recommendations}<Shelf
        title={data.recommendations.title}
        href="/for-you?section=recommendations"
        items={data.recommendations.items}
      filterBy="type" />{/if}<Shelf source={{type:"social",mediums:true}} /><Shelf source={{type:"social",surface:"popular",mediums:true}} /><Shelf title="From your library" items={data.library} href="/library" filterBy="type" />  {/if}
</div>
