<script lang="ts">
  import { page } from '$app/state';
  import Heading from '$lib/ui/components/Heading.svelte';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { data } = $props();
  const section = $derived(page.url.searchParams.get('section') === 'activity');
</script>

<svelte:head><title>For You · Coast</title></svelte:head>
{#if data.hero && !section}<MediaHero item={data.hero} next={data.heroNext} context="home" />{/if}
<div class="content" class:page={!data.hero || !!section} style="padding-bottom:90px">
  {#if section}
    <Button href="/for-you" emphasis="subtle" icon="left">For You</Button>
    <Shelf source={{type:'social',layout:'grid',mediums:true,category:page.url.searchParams.get('category')??'screen'}} />
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
      >{/if}<Shelf source={{ type: 'progress', mediums: true, initial: data.progress }} /><Shelf source={{ type: 'progress', surface: "next", mediums: true }} /><Shelf source={{ type: 'progress', surface: "recommendations", mediums: true }} /><Shelf source={{ type: 'progress', surface: "favourites", mediums: true }} /><Shelf source={{type:"social",surface:"popular",mediums:true}} /><Shelf source={{type:"social",mediums:true}} />  {/if}
</div>
