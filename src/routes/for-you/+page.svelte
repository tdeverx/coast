<script lang="ts">
  const dev=import.meta.env.DEV;
  import {onDestroy,untrack} from 'svelte';
  import {createResource} from '#lib/ui/resource.svelte.js';
  import {reportImportFailure} from '#lib/ui/client-context.js';
  const dynamicImport=createResource<typeof import('#lib/recommendations/DynamicFeed.svelte').default|undefined>(undefined);
  const DynamicFeed=$derived(dynamicImport.data);
  import {dynamicKind,type GenreReason} from '#lib/recommendations/model.js';
  import { page } from '$app/state';
  import Heading from '#lib/ui/components/Heading.svelte';
  import MediaHero from '#lib/ui/components/MediaHero.svelte';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  let { data } = $props();
  const section = $derived(page.url.searchParams.get('section'));
  const dynamicWanted=$derived(!!page.data.user&&page.data.capabilities?.personalisation&&!section);
  function loadDynamic(){if(dynamicWanted&&!dynamicImport.busy)return dynamicImport.load(async()=> (await import('#lib/recommendations/DynamicFeed.svelte')).default);}
  $effect(()=>{const viewer=page.data.user?.id;if(!viewer||!dynamicWanted)return;untrack(()=>{if(!dynamicImport.data)void loadDynamic();});return()=>dynamicImport.cancel();});
  onDestroy(()=>dynamicImport.dispose());
  reportImportFailure(()=>dynamicWanted&&dynamicImport.error?'Recommendations could not load. Reload the page to try again.':'');
</script>

<svelte:head><title>For You · Coast</title></svelte:head>
{#if data.heroes.length && !section}<MediaHero items={data.heroes} next={data.heroNext} context="home" />{/if}
<div class="content" class:page={!data.heroes.length || !!section} style:padding-bottom={!section ? '0px' : '90px'}>
  {#if section}
    <Button href="/for-you" emphasis="subtle" icon="left">For You</Button>
    {#if section === 'upcoming' && page.data.experiments.planning}
      <Shelf source={{type:'for-you',feature:'upcoming',layout:'grid'}} />
    {:else if section === 'recommendations'}
      <Shelf source={{type:'for-you',feature:'recommendations',layout:'grid'}} />
    {:else if section === 'dynamic' && (page.url.searchParams.get('genre') || page.url.searchParams.get('work'))}
      <Shelf source={{type:'for-you',feature:'row',genre:page.url.searchParams.get('genre')??undefined,workId:page.url.searchParams.get('work')??undefined,kind:dynamicKind(page.url.searchParams.get('kind')),reason:(['liked','watched','saved','explore'].includes(page.url.searchParams.get('reason')??'')?page.url.searchParams.get('reason'):undefined) as GenreReason|undefined,layout:'grid'}} />
    {:else if section === 'popular'}
      <Shelf source={{type:'social',surface:'popular',layout:'grid',mediums:true,category:page.url.searchParams.get('category')??'screen'}} />
    {:else}
      <Shelf source={{type:'social',layout:'grid',mediums:true,category:page.url.searchParams.get('category')??'screen'}} />
    {/if}
  {:else}
    {#if !data.heroes.length}
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
    {#if dev}<Shelf source={{type:'progress-experiment'}} hideEmpty={false} />
    {:else}<Shelf source={{type:'progress',mediums:true}} />
    <Shelf source={{type:'progress',surface:'next',mediums:true}} />{/if}
    {#if page.data.capabilities.social}<Shelf source={{type:'progress',surface:'recommendations',mediums:true}} />{/if}
    {#if !dev}<Shelf source={{type:'progress',surface:'favourites',mediums:true}} />{/if}
    {#if page.data.experiments.planning}<Shelf source={{type:'for-you',feature:'upcoming'}} />{/if}
    {#if page.data.capabilities.social}<Shelf source={{type:'social',mediums:true}} />{/if}
    {#if page.data.capabilities?.personalisation&&DynamicFeed}<DynamicFeed />{/if}
  {/if}
</div>
