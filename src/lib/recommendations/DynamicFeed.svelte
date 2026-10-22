<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import {onDestroy,untrack} from 'svelte';
 import {page} from '$app/state';
 import {useClient} from '#lib/ui/client-context.js';
 import {createResource} from '#lib/ui/resource.svelte.js';
 import {lazyContent} from '#lib/ui/lazy-content.js';
 import Shelf from '#lib/ui/components/Shelf.svelte';
 import type {DynamicRow} from './model';
 import {dynamicRowShape} from './row-ranking';
 let {category}:{category?:import('./model').DynamicMedium}=$props();
 const {api}=useClient();
 let revision=$state(0);
 let seed=$state('initial');
 let pendingKey=$state<string>();
 const resource=createResource({rows:[] as DynamicRow[]},false);
 let snapshotLoaded=$state(false),revealed=$state(0);
 const rows=$derived(resource.data.rows.slice(0,revealed));
 const complete=$derived(snapshotLoaded&&revealed>=resource.data.rows.length);
 async function load(){
  if(resource.busy||pendingKey||complete)return;
  if(!snapshotLoaded){
   const visitSeed=seed;
   const result=await resource.load(signal=>api<typeof resource.data>(`experiments/feed?${new URLSearchParams({seed,...(category?{category}:{})})}`,undefined,'GET',{signal}));
   if(!result||seed!==visitSeed)return;
   snapshotLoaded=true;
  }
  const next=resource.data.rows[revealed];
  if(next){pendingKey=next.key;revealed++;}
 }
 function settled(key:string){if(pendingKey===key){pendingKey=undefined;revision++;}}
 // Row contents subscribe to their own revisions. The definition cursor/order
 // belongs to this visit; edits must not replay all previously consumed pages.
 const scopeKey=$derived(JSON.stringify([category,page.data.user?.id,page.data.capabilities,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics]));
 $effect(()=>{scopeKey;untrack(()=>{
  revision++;
  seed=Math.random().toString(36).slice(2);
  pendingKey=undefined;
  snapshotLoaded=false;revealed=0;
  resource.replace({rows:[]});
 });});
 onDestroy(resource.dispose);

  reportFailure(()=>resource.error, ()=>void load());
</script>
<div aria-label="Dynamic For You" class="dynamic-feed">
 {#each rows as row (row.key)}
  {@const shape=dynamicRowShape(row,seed)}
  {@const artworkStyle=shape==='poster'?'primary':shape==='fanart'?'thumb':undefined}
  {#if row.surface==='popular'}
   <Shelf {shape} {artworkStyle} source={{type:'social',surface:'popular',category:row.category,title:row.title}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='recommendations'}
   <Shelf {shape} {artworkStyle} source={{type:'for-you',feature:'recommendations',category:row.category,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='seed'}
   <Shelf {shape} {artworkStyle} source={{type:'for-you',feature:'row',category:row.category,workId:row.workId,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {:else}
   <Shelf {shape} {artworkStyle} source={{type:'for-you',feature:'row',category:row.category,genre:row.genre,kind:row.kind,reason:row.reason,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {/if}
 {/each}
 <div class="feed-end">
  <div class="feed-loader">
   {#if !pendingKey && !complete}
    {#key `${revision}:${revealed}`}
     <div use:lazyContent={{load:()=>void load(),rootMargin:'0px',enabled:()=>!resource.busy&&!resource.error}} aria-busy={resource.busy} style="min-height:1px">
      {#if resource.busy}<span class="sr-only" role="status">Loading the next row…</span>{/if}

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
