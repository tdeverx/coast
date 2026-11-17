<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import { actionCategories } from '#lib/actions.js';
  import { surfaceEnabled } from '#lib/experimental.js';
  import DynamicFeed from '#lib/recommendations/DynamicFeed.svelte';
  import { recommendationSectionSource } from '#lib/recommendations/section.js';
  import Button from '#lib/ui/components/Button.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import MediaHero from '#lib/ui/components/MediaHero.svelte';
  import Shelf from '#lib/ui/components/Shelf.svelte';

  let { data } = $props();
  setContext('profile-read-only', () => !page.data.user);
  const section = $derived(page.url.searchParams.get('section'));
  const category = $derived(actionCategories[data.selection.surface]);
  const recommendation = $derived(recommendationSectionSource(page.url,category,'generic'));
  const mediums = $derived({...page.data, features:page.data.capabilities});
  const enabled = $derived(surfaceEnabled(mediums,data.selection.surface));
</script>

<svelte:head><title>Discover · Coast</title></svelte:head>
{#if data.featured.length && !section}
  <MediaHero items={data.featured} context="discover" />
{/if}
<div class="content" class:page={!data.featured.length || !!section} style="padding-bottom:90px">
  {#if section}
    <Button href={`/discover?view=${data.selection.surface}`} emphasis="subtle" icon="left">Discover</Button>
    {#if recommendation}
      {#key `${section}:${category}:${page.url.searchParams.get('kind')}:${page.url.searchParams.get('genre')}:${page.url.searchParams.get('variant')}:${page.url.searchParams.get('seed')}:${page.data.user?.id}`}
        <Shelf source={recommendation} />
      {/key}
    {:else if data.selected}
      {#key `${section}:${data.selection.surface}:${data.selection.kind}:${data.selection.page}`}
        <Shelf source={{type:'discovery',layout:'grid',scoped:true,mediums,
          ...data.selection,initial:data.selected}} />
      {/key}
    {/if}
  {:else}
    {#if !data.featured.length}<Heading variant="page" title="Discover" />{/if}
    {#if enabled}
      {#key `${data.selection.surface}:${page.data.user?.id}`}
        {#if data.selection.surface==='watch' && !data.configured && !data.featured.length && page.data.user?.role==='admin'}
          <Button href="/settings/integrations" emphasis="subtle">Set up discovery</Button>
        {/if}
        <DynamicFeed {category} mode="generic" />
        {#if data.tmdb}<p class="small quiet attribution">Metadata provided by TMDB. This product is not endorsed or certified by TMDB.</p>{/if}
      {/key}
    {:else}
      <EmptyState title="Discover is unavailable" description="Choose an enabled media type." icon="discover" />
    {/if}
  {/if}
</div>

<style>
  .attribution { margin-top: var(--gutter); }
</style>
