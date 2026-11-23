<script lang="ts">
 import {onDestroy,untrack} from 'svelte';
 import {page} from '$app/state';
 import {reportFailure,useClient} from '#lib/ui/client-context.js';
 import {createResource} from '#lib/ui/resource.svelte.js';
 import {lazyContent} from '#lib/ui/lazy-content.js';
 import Shelf from '#lib/ui/components/Shelf.svelte';
 import type {DynamicRow} from './model';
 import {dynamicRowShape} from './row-ranking';
 import {actionFromCategory} from '#lib/actions.js';
 let {category,mode='personal'}:{category?:import('./model').DynamicMedium;mode?:'personal'|'generic'}=$props();
 const {api}=useClient();
 let seed=$state('initial');
 let settledCount=$state(0);
 let lastVisibleKey=$state<string>();
 const resource=createResource({rows:[] as DynamicRow[]},false);
 let snapshotLoaded=$state(false),revealed=$state(0);
 const rows=$derived(resource.data.rows.slice(0,revealed));
 const pendingKey=$derived(rows[settledCount]?.key);
 const complete=$derived(snapshotLoaded&&settledCount>=resource.data.rows.length);
 const pairSize=2;
 async function load(){
  if(resource.busy||pendingKey||complete)return;
  if(!snapshotLoaded){
   const visitSeed=seed;
   const result=await resource.load(signal=>api<typeof resource.data>(`${mode==='generic'?'discover':'experiments'}/feed?${new URLSearchParams({seed,...(category?{category}:{})})}`,undefined,'GET',{signal}));
   if(!result||seed!==visitSeed)return;
   snapshotLoaded=true;
  }
  revealed=Math.min(resource.data.rows.length,revealed+pairSize);
 }
 function settled(key:string,empty=false){
  if(key!==pendingKey)return;
  settledCount++;
  // Only a visible shelf can be the next demand boundary. Even a series of
  // empty pairs must stop fetching once the reader leaves this part of the page.
  if(!empty)lastVisibleKey=key;
 }
 // On For You the first pair follows the last enabled static shelf. The
 // boundary also covers an empty static shelf and Discover's standalone feed.
 function watchStart(node:HTMLElement){
  const boundary=lazyContent(node,{load:()=>void load(),rootMargin:'0px 0px 240px'});
  let previous=node.parentElement?.previousElementSibling;
  while(previous?.matches('[data-shelf]')){
   const section=previous.querySelector<HTMLElement>(':scope > section:not([hidden])');
   if(section){
    const stop=watchLastRow(section);
    return ()=>{stop();boundary.destroy();};
   }
   previous=previous.previousElementSibling;
  }
  return boundary.destroy;
 }
 function watchLastRow(node:HTMLElement){
  return lazyContent(node,{load:()=>void load(),rootMargin:'0px'}).destroy;
 }
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
  seed=Math.random().toString(36).slice(2);
  settledCount=0;lastVisibleKey=undefined;
  snapshotLoaded=false;revealed=0;
  resource.replace({rows:[]});
 });});
 onDestroy(resource.dispose);

 reportFailure(()=>resource.error, ()=>void load());
</script>
<div aria-label={mode==='generic'?'Discover recommendations':'For You recommendations'} class="dynamic-feed">
 {#if !snapshotLoaded && resource.busy}
  {#each Array(pairSize) as _}<Shelf busy size={category==='music'?'square':'poster'} enrichSocial={false} artworkOptions={false} />{/each}
 {:else if !lastVisibleKey && !pendingKey && !complete && !resource.error}
  <div class="feed-start" {@attach watchStart}></div>
 {/if}
 {#each rows as row, index (row.key)}
  {@const shape=dynamicRowShape(row,seed)}
  {@const artworkStyle=shape==='poster'?'primary':shape==='fanart'?'thumb':undefined}
  {@const feedLoad=index<=settledCount?'active':'queued'}
  <div {@attach row.key===lastVisibleKey && !pendingKey && !complete ? watchLastRow : undefined}>
  {#if row.surface==='popular'}
   <Shelf {shape} {artworkStyle} {feedLoad} source={{type:'social',surface:'popular',category:row.category,title:row.title}} onsettled={empty=>settled(row.key,empty)} />
  {:else if row.surface==='discovery'}
   <Shelf {feedLoad} source={{type:'discovery',section:row.section,surface:actionFromCategory(row.category),scoped:true,
     mediums:{...page.data,features:page.data.capabilities}}} onsettled={empty=>settled(row.key,empty)} />
  {:else if row.surface==='recommendations'}
   <Shelf {shape} {artworkStyle} {feedLoad} source={{type:'recommendation',mode,feature:'recommendations',category:row.category,kind:row.kind,title:row.title,available:row.available,seed}} onsettled={empty=>settled(row.key,empty)} />
  {:else if row.surface==='seed'}
   <Shelf {shape} {artworkStyle} {feedLoad} source={{type:'recommendation',mode,feature:'row',category:row.category,workId:row.workId,title:row.title,seed}} onsettled={empty=>settled(row.key,empty)} />
  {:else if row.surface==='browse'}
   <Shelf {shape} {artworkStyle} {feedLoad} source={{type:'recommendation',mode,feature:'browse',category:row.category,genre:row.genre,kind:row.kind,variant:row.variant,title:row.title,seed}} onsettled={empty=>settled(row.key,empty)} />
  {:else}
   <Shelf {shape} {artworkStyle} {feedLoad} source={{type:'recommendation',mode,feature:'row',category:row.category,genre:row.genre,kind:row.kind,reason:row.reason,title:row.title,available:row.available,seed}} onsettled={empty=>settled(row.key,empty)} />
  {/if}
  </div>
 {/each}
</div>
<style>
 /* Keep the viewport in place when the document grows at the feed's end. */
 :global(body:has(.dynamic-feed)) { overflow-anchor:none; }
 .feed-start { min-height:1px; }
</style>
