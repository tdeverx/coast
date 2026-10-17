<script lang="ts">
 import {page} from '$app/state';
 import MediaDetails from '$lib/ui/components/MediaDetails.svelte';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import type {DetailRowsModel} from '$lib/ui/pages/detail-rows';
 let {data,detailHref}:{detailHref?:string;data:{group:{id:string;title:string};cover:string|null;statistics?:{issues:number;completed:number;reading:number;available:number}}}=$props();
 const detailUrl=$derived(detailHref?new URL(detailHref,page.url):page.url);
 const section=$derived(detailUrl.searchParams.get('section'));
 const model=$derived<DetailRowsModel>({insights:data.statistics?{selection:'overview',href:`/media/reading-collection/${data.group.id}?section=insights`,tabs:[{value:'overview',label:'Overview',panels:[{title:'Your reading',content:{kind:'metrics',props:{items:[
  {label:'Known issues',value:data.statistics.issues},{label:'Available to you',value:data.statistics.available},{label:'Reading',value:data.statistics.reading},{label:'Completed',value:data.statistics.completed},
 ]}},footerText:'Counts cover issues already identified in Coast. Browse Issues for the complete provider run.'}]}]}:undefined});
</script>
<svelte:head><title>{data.group.title} · Coast</title></svelte:head>
<MediaDetails {detailHref} {section} view={{hero:!section,item:{id:`reading-group:${data.group.id}`,kind:'collection',title:data.group.title,
 href:`/media/reading-collection/${data.group.id}`,poster:data.cover,captionSubtitle:'Comic volume'}}} {model}>
 {#snippet hierarchy()}{#if !section||section==='issues'}<Shelf source={{type:'detail',title:'Issues',path:`reading/collections/${data.group.id}`,layout:'grid',
  mediaKind:'reading',page:Number(detailUrl.searchParams.get('page')??1)}} />{/if}{/snippet}
</MediaDetails>
