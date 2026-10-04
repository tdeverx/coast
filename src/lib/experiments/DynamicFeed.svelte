<script lang="ts">
 import {onDestroy,untrack} from 'svelte';
 import {page} from '$app/state';
 import {useClient} from '$lib/ui/client-context';
 import {createResource,uniqueItems} from '$lib/ui/resource.svelte';
 import {contentRevisionKey} from '$lib/ui/content-revision.svelte';
 import {lazyContent} from '$lib/ui/lazy-content';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
 import type {DynamicRow} from './dynamic.server';
 import {dynamicRowShape} from './row-ranking';
 const {api}=useClient();
 let revision=$state(0);
 let seed=$state('initial');
 let pendingKey=$state<string>();
 const resource=createResource({rows:[] as DynamicRow[],nextOffset:0 as number|null},false);
 async function load(){
  if(resource.busy||pendingKey||resource.data.nextOffset===null)return;
  const offset=resource.data.nextOffset;
  await resource.load(signal=>api<typeof resource.data>(`experiments/feed?offset=${offset}&limit=1&seed=${seed}`,undefined,'GET',{signal}),{
   merge:(previous,next)=>{
    const rows=uniqueItems([...previous.rows,...next.rows],row=>row.key);
    if(rows.length>previous.rows.length)pendingKey=rows.at(-1)!.key;
    return {...next,rows};
   }
  });
 }
 function settled(key:string){if(pendingKey===key){pendingKey=undefined;revision++;}}
 const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['tracking','social']),page.data.experimentalMusic,page.data.experimentalGaming]));
 $effect(()=>{refreshKey;untrack(()=>{
  revision++;
  if(seed==='initial')seed=Math.random().toString(36).slice(2);
  const rows=resource.data.rows.filter(row=>(row.category==='screen'||row.category==='game'&&page.data.experimentalGaming||row.category==='music'&&page.data.experimentalMusic));
  if(pendingKey&&!rows.some(row=>row.key===pendingKey))pendingKey=undefined;
  resource.replace({rows,nextOffset:0});
 });});
 onDestroy(resource.cancel);
</script>
<div aria-label="Dynamic For You" class="dynamic-feed">
 {#each resource.data.rows as row (row.key)}
  {@const shape=dynamicRowShape(row,seed)}
  {@const artworkStyle=shape==='poster'?'primary':shape==='fanart'?'thumb':undefined}
  {#if row.surface==='popular'}
   <Shelf {shape} {artworkStyle} source={{type:'social',surface:'popular',category:row.category,title:row.title}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='recommendations'}
   <Shelf {shape} {artworkStyle} source={{type:'experimental',feature:'recommendations',category:row.category,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='seed'}
   <Shelf {shape} {artworkStyle} source={{type:'experimental',feature:'row',category:row.category,workId:row.workId,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {:else}
   <Shelf {shape} {artworkStyle} source={{type:'experimental',feature:'row',category:row.category,genre:row.genre,kind:row.kind,reason:row.reason,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {/if}
 {/each}
 <div class="feed-end">
  <div class="feed-loader">
   {#if !pendingKey && resource.data.nextOffset!==null}
    {#key `${revision}:${resource.data.nextOffset}`}
     <div use:lazyContent={{load:()=>void load(),rootMargin:'0px',enabled:()=>!resource.busy&&!resource.error}} aria-busy={resource.busy} style="min-height:1px">
      {#if resource.busy}<span class="sr-only" role="status">Loading the next row…</span>{/if}
      {#if resource.error}<RowFeedback error={resource.error} inline={false} retry={()=>void load()} />{/if}
     </div>
    {/key}
   {/if}
  </div>
 </div>
</div>
<style>
 .feed-end { padding-top:90px; }
 .feed-loader { min-height:1px; }
</style>
