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
 import {actionFromCategory} from '#lib/actions.js';
 let {category,mode='personal'}:{category?:import('./model').DynamicMedium;mode?:'personal'|'generic'}=$props();
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
   const result=await resource.load(signal=>api<typeof resource.data>(`${mode==='generic'?'discover':'experiments'}/feed?${new URLSearchParams({seed,...(category?{category}:{})})}`,undefined,'GET',{signal}));
   if(!result||seed!==visitSeed)return;
   snapshotLoaded=true;
  }
  const next=resource.data.rows[revealed];
  if(next){pendingKey=next.key;revealed++;}
 }
 function settled(key:string){if(pendingKey===key){pendingKey=undefined;revision++;}}
 // Row contents subscribe to their own revisions. The definition cursor/order
 // belongs to this visit; edits must not replay all previously consumed pages.
 const scopeKey=$derived(JSON.stringify([category,mode,page.data.user?.id,
  mode==='personal'&&page.data.capabilities?.personalisation,
  (!category||category==='screen')&&page.data.capabilities?.screen,
  (!category||category==='game')&&page.data.experimentalGaming,
  (!category||category==='music')&&page.data.experimentalMusic,
  (!category||category==='reading')&&[page.data.experimentalBooks,page.data.capabilities?.book,page.data.experimentalComics,page.data.capabilities?.comic],
 ]));
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
<div aria-label={mode==='generic'?'Discover recommendations':'For You recommendations'} class="dynamic-feed">
 {#each rows as row (row.key)}
  {@const shape=dynamicRowShape(row,seed)}
  {@const artworkStyle=shape==='poster'?'primary':shape==='fanart'?'thumb':undefined}
  {#if row.surface==='popular'}
   <Shelf {shape} {artworkStyle} appendWhenReady source={{type:'social',surface:'popular',category:row.category,title:row.title}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='discovery'}
   <Shelf appendWhenReady source={{type:'discovery',section:row.section,surface:actionFromCategory(row.category),scoped:true,
     mediums:{...page.data,features:page.data.capabilities}}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='recommendations'}
   <Shelf {shape} {artworkStyle} appendWhenReady source={{type:'recommendation',mode,feature:'recommendations',category:row.category,kind:row.kind,title:row.title,available:row.available,seed}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='seed'}
   <Shelf {shape} {artworkStyle} appendWhenReady source={{type:'recommendation',mode,feature:'row',category:row.category,workId:row.workId,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {:else if row.surface==='browse'}
   <Shelf {shape} {artworkStyle} appendWhenReady source={{type:'recommendation',mode,feature:'browse',category:row.category,genre:row.genre,kind:row.kind,variant:row.variant,title:row.title,seed}} onsettled={()=>settled(row.key)} />
  {:else}
   <Shelf {shape} {artworkStyle} appendWhenReady source={{type:'recommendation',mode,feature:'row',category:row.category,genre:row.genre,kind:row.kind,reason:row.reason,title:row.title,available:row.available,seed}} onsettled={()=>settled(row.key)} />
  {/if}
 {/each}
 <div class="feed-end" aria-busy={resource.busy || !!pendingKey}>
   {#if !pendingKey && !complete}
    {#key `${revision}:${revealed}`}
     <div class="feed-trigger" use:lazyContent={{load:()=>void load(),rootMargin:'0px 0px 240px',enabled:()=>!resource.busy&&!resource.error}}></div>
    {/key}
   {/if}
 </div>
</div>
<style>
 /* Keep the viewport in place when the document grows at the feed's end. */
 :global(body:has(.dynamic-feed)) { overflow-anchor:none; }
 .feed-end { min-height:1px; }
 .feed-trigger { min-height:1px; }
</style>
