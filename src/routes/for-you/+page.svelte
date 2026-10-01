<script lang="ts">
  import { homeShelves } from '$lib/ui/shelves/home';
  import { page } from '$app/state';
  import Heading from '$lib/ui/components/Heading.svelte';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import AddTitle from '$lib/ui/components/AddTitle.svelte';
  let { data } = $props();
  const section = $derived(page.url.searchParams.get('section'));
  let addOpen = $state(false);
</script>

<svelte:head><title>For You · Coast</title></svelte:head>
{#if data.hero && !section}<MediaHero item={data.hero} next={data.heroNext} context="home" />{/if}
<div class="content" class:page={!data.hero || !!section} style="padding-bottom:90px">
  {#if section}
    <Button href="/for-you" variant="ghost" icon="left">For You</Button>
    {#key section}<Shelf
        title={section === 'recent'
          ? 'Recently watched'
          : (data.recommendations?.title ?? 'Recommendations')}
        items={section === 'recent' ? data.recentlyWatched : (data.recommendations?.items ?? [])}
        layout="grid"
      filterBy="type" />{/key}
  {:else}
    {#if !data.hero}<Heading variant="page" title="For You" description="Your stories, all together.">
        {#snippet actions()}<Button variant="secondary" icon="plus" onclick={() => (addOpen = true)}
            >Add a title</Button
          >{/snippet}
      </Heading>
      <EmptyState
        title="Your next story starts here."
        description="Build a watchlist, remember what you’ve seen, and pick up wherever you left off. Coast keeps it all together."
        icon="home"
        ><div class="row" style="justify-content:center">
          <Button href="/discover">Find something to watch</Button><Button
            variant="secondary"
            onclick={() => (addOpen = true)}>Add a title</Button
          >
        </div></EmptyState
      >{/if}<Shelf source={{ type: 'progress', initial: data.progress }} /><Shelf source={{ type: 'progress', surface: "watchlist" }} /><Shelf source={{ type: 'progress', surface: "favourites" }} /><Shelf
      title="Recently watched"
      href="/for-you?section=recent"
      items={data.recentlyWatched}
      shape="fanart"
    filterBy="type" />{#if data.recommendations}<Shelf
        title={data.recommendations.title}
        href="/for-you?section=recommendations"
        items={data.recommendations.items}
      filterBy="type" />{/if}<Shelf title="From your library" items={data.library} href="/library" filterBy="type" />{#each homeShelves(data.mediaRows, true) as source}<Shelf {source} />{/each}{#if data.hero}<div class="section row">
        <Button variant="ghost" icon="plus" onclick={() => (addOpen = true)}>Add a title</Button
        ><Button variant="ghost" href="/lists" icon="list">Your lists</Button>
      </div>{/if}
  {/if}
</div>
<AddTitle bind:open={addOpen} />
