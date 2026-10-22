<script lang="ts">

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
  import {actionCategories,actionHref} from '#lib/actions.js';
  import {surfaceEnabled} from '#lib/experimental.js';
  import Button from '#lib/ui/components/Button.svelte';
  let { data } = $props();
  const category=$derived(actionCategories[data.action]);
  const progressCategory=$derived(data.action==='watch'?'screen':data.action==='play'?'game':'reading');
  const enabled=$derived(surfaceEnabled({...page.data,features:page.data.capabilities},data.action));
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
  {#key `${data.action}:${page.data.user?.id}`}
  {#if enabled}
  {#if section}
    <Button href={actionHref('/for-you',data.action)} emphasis="subtle" icon="left">For You</Button>
    {#if section==='recent'||section==='requests'&&data.action==='watch'}
      <Shelf source={{type:'library-feed',feature:section,action:data.action,layout:'grid',kind:page.url.searchParams.get('kind')??undefined,state:page.url.searchParams.get('state')??undefined}} hideEmpty={false}/>
    {:else if section === 'upcoming' && page.data.experiments.planning}
      <Shelf source={{type:'for-you',feature:'upcoming',category,layout:'grid'}} />
    {:else if section === 'recommendations'}
      <Shelf source={{type:'for-you',feature:'recommendations',category,layout:'grid'}} />
    {:else if section === 'dynamic' && (page.url.searchParams.get('genre') || page.url.searchParams.get('work'))}
      <Shelf source={{type:'for-you',feature:'row',category,genre:page.url.searchParams.get('genre')??undefined,workId:page.url.searchParams.get('work')??undefined,kind:dynamicKind(page.url.searchParams.get('kind')),reason:(['liked','watched','saved','explore'].includes(page.url.searchParams.get('reason')??'')?page.url.searchParams.get('reason'):undefined) as GenreReason|undefined,layout:'grid'}} />
    {:else if section === 'popular'}
      <Shelf source={{type:'social',surface:'popular',layout:'grid',category}} />
    {:else}
      <Shelf source={{type:'social',layout:'grid',category,...data.activityFilters}} />
    {/if}
  {:else}
    {#if !data.heroes.length}<Heading variant="page" title="For You" />{/if}
    {#if data.action!=='listen'}
      <Shelf source={{type:'progress-experiment',category:progressCategory}} hideEmpty={false}/>
    {:else}
      <Shelf source={{type:'library',surface:'listen',title:'Music library',rows:1,initialSelection:'album',initialScope:'all',entitySegments:true,kindControl:false}} />
    {/if}
    {#if data.action==='watch'&&page.data.capabilities.requests&&page.data.capabilities.screen}<Shelf source={{type:'library-feed',feature:'requests'}} hideEmpty={false}/>{/if}
    <Shelf source={{type:'library-feed',feature:'recent',action:data.action}} hideEmpty={false}/>
    {#if page.data.capabilities.social}<Shelf source={{type:'progress',surface:'recommendations',category,actionScoped:true}} />{/if}
    {#if data.action==='listen'}<Shelf source={{type:'progress',surface:'watchlist',category,actionScoped:true}}/><Shelf source={{type:'progress',surface:'favourites',category,actionScoped:true}}/>{/if}
    {#if data.action!=='listen'&&page.data.experiments.planning}<Shelf source={{type:'for-you',feature:'upcoming',category}} />{/if}
    {#if page.data.capabilities.social}<Shelf source={{type:'social',category,audience:'friends'}} />{/if}
    {#if page.data.capabilities?.personalisation&&DynamicFeed}<DynamicFeed {category} />{/if}
  {/if}
  {/if}
  {/key}
</div>
