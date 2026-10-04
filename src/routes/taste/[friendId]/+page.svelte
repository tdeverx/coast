<script lang="ts">
 import {displayLabel} from '$lib/ui/labels';
 import {goto} from '$app/navigation';
 import {page} from '$app/state';
 import {openFriends} from '$lib/social/panel.svelte';
 import Heading from '$lib/ui/components/Heading.svelte';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
 import RowFilter from '$lib/ui/components/RowFilter.svelte';
 let {data}=$props();
</script>
<svelte:head><title>Taste & overlap · Coast</title></svelte:head>
<div class="content page"><Heading variant="page" title="Taste & overlap" description={data.username}>{#snippet actions()}<Button emphasis="subtle" icon="user" onclick={openFriends}>Friends</Button>{/snippet}</Heading>
  {#if data.comparison}<MetricGrid items={[{label:'Overall taste',value:data.comparison.score===null?'Not enough data':`${data.comparison.score}%`,detail:'Median across qualifying media'}]} />
   {#each data.comparison.media as medium}<section class="section"><Heading title={medium.medium} /><MetricGrid items={[{label:'Taste score',value:medium.score===null?'Not enough data':`${Math.round(medium.score)}%`},...Object.entries(medium.signals).filter(([name,signal])=>['ratings','genres','reactions','interests'].includes(name)||signal.score!==null).map(([name,signal])=>({label:displayLabel(name),value:signal.score===null?'Not enough data':`${Math.round(signal.score)}%`,detail:`${signal.shared?signal.shared+' shared · ':''}${signal.left} yours · ${signal.right} theirs`})),{label:'Completed · you / friend',value:`${medium.stats.you.completed} / ${medium.stats.friend.completed}`},{label:'In progress · you / friend',value:`${medium.stats.you.active} / ${medium.stats.friend.active}`},{label:'Planned · you / friend',value:`${medium.stats.you.planned} / ${medium.stats.friend.planned}`},{label:'Shared items',value:medium.overlap.shared.length},{label:'Only you',value:medium.overlap.onlyYou.length},{label:'Only your friend',value:medium.overlap.onlyFriend.length}]} /></section>{/each}
   <Shelf title="Overlap & progress" items={data.overlapItems} layout="grid" pageNumber={data.page} pages={data.overlapPages} pageUrl={number=>{const url=new URL(page.url);url.searchParams.set('page',String(number));return url.pathname+url.search;}}>
    {#snippet filters()}<RowFilter groups={[{label:"Overlap medium", value:data.medium, options:[{value:'all',label:'All media'},{value:'movies',label:'Movies'},{value:'tv',label:'TV'},...(page.data.experimentalMusic?[{value:'music',label:'Music'}]:[]),...(page.data.experimentalGaming?[{value:'game',label:'Games'}]:[])], change:value=>{const url=new URL(page.url);url.searchParams.set('medium',value);url.searchParams.delete('page');void goto(url);}}, {label:"Overlap relationship", value:data.overlap, options:[{value:'shared',label:'Shared items'},{value:'onlyYou',label:'Only you'},{value:'onlyFriend',label:'Only your friend'}], change:value=>{const url=new URL(page.url);url.searchParams.set('overlap',value);url.searchParams.delete('page');void goto(url);}}]} />{/snippet}
    {#snippet details(item)}{@const progress=data.comparison?.media.flatMap(m=>m.progressComparisons).find(p=>p.workId===('workId' in item?item.workId??item.id:item.id))}{#if progress}<p class="small">Progress · You: {progress.you===null?'Unknown':`${Math.round(progress.you)}%`} · Friend: {progress.friend===null?'Unknown':`${Math.round(progress.friend)}%`}</p>{/if}{/snippet}
   </Shelf>
  {/if}
</div>
