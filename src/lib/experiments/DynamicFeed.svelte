<script lang="ts">
 import {onDestroy,untrack} from 'svelte';
 import {page} from '$app/state';
 import {useClient} from '$lib/ui/client-context';
 import {createResource} from '$lib/ui/resource.svelte';
 import {lazyContent} from '$lib/ui/lazy-content';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
 import type {DynamicRow} from './dynamic.server';
 const {api}=useClient();
 let revision=$state(0);
 const resource=createResource({rows:[] as DynamicRow[],nextOffset:0 as number|null},false);
 async function load(){
  if(resource.busy||resource.data.nextOffset===null)return;
  const offset=resource.data.nextOffset;
  await resource.load(signal=>api<typeof resource.data>(`experiments/feed?offset=${offset}`,undefined,'GET',{signal}),{merge:(previous,next)=>({...next,rows:[...previous.rows,...next.rows.filter(row=>!previous.rows.some(existing=>existing.key===row.key))]})});
 }
 $effect(()=>{page.data;untrack(()=>{revision++;resource.replace({rows:[],nextOffset:0});});});
 onDestroy(resource.cancel);
</script>
<div aria-label="Dynamic For You" class="dynamic-feed">
 <p class="small muted">Experimental Dynamic For You · visual treatment unapproved</p>
 {#each resource.data.rows as row (row.key)}
  <Shelf source={{type:'experimental',feature:'row',category:row.category,genre:row.genre,title:row.title}} />
 {/each}
 {#if resource.data.nextOffset!==null}
  {#key `${revision}:${resource.data.nextOffset}`}
   <div use:lazyContent={{load:()=>void load(),enabled:()=>!resource.busy&&!resource.error}} aria-busy={resource.busy}>
    {#if !resource.data.rows.length||resource.busy}<Shelf title="Suggested for you" busy availability={false}/>{/if}
    {#if resource.error}<RowFeedback error={resource.error} tag="p"/><Button onclick={()=>void load()}>Retry</Button>{/if}
   </div>
  {/key}
 {/if}
</div>
