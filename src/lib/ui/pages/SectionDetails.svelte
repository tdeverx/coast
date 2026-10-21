<script lang="ts">
 import {onDestroy,untrack} from 'svelte';
 import {useClient} from '#lib/ui/client-context.js';
 import {createResource,uniqueItems} from '#lib/ui/resource.svelte.js';
 import {profileActivityPanels,profileBreakdownPanels} from '#lib/ui/insights/profile.js';
 import {mediaTypeOptions} from '#lib/ui/filter-options.js';
 import DetailCard from '../components/DetailCard.svelte';
 import MetricGrid from '../components/MetricGrid.svelte';
 import ProfileRecap from '../components/ProfileRecap.svelte';
 import SegmentedControl from '../components/SegmentedControl.svelte';
 import {page} from '$app/state';
 import {sectionTarget} from '#lib/ui/section-target.js';
 import Shelf from '../components/Shelf.svelte';
 let {href}:{href:string}=$props();
 const target=$derived(sectionTarget(href,page.url));
 const selection=$derived(target&&'profile' in target?target.profile:undefined);
 type Content=Partial<Awaited<ReturnType<typeof import('#lib/server/queries/profile.js').profileInsightsData>>>&{items:import('#lib/ui/shelves/types.js').ShelfItem[];page:number;pages:number;favourites?:import('#lib/ui/shelves/types.js').ShelfItem[]};
 const resource=createResource<Content>({items:[],page:1,pages:1});
 const {api}=useClient();
 let period=$state<'all'|'month'|'year'>(untrack(()=>selection?.period??'all'));
 let kind=$state(untrack(()=>selection?.kind??'all'));
 async function load(number=1,append=false){if(selection)await resource.load(async signal=>{
  const result=await api<Content>(`profile/section?${new URLSearchParams({section:selection.section,username:selection.username,period,kind,scope:selection.scope,page:String(number)})}`,undefined,'GET',{signal});
  return {...result,items:result.favourites??[]};
 },{merge:(old,next)=>({...next,items:append?uniqueItems([...old.items,...next.items],item=>item.entryId??item.id):next.items})});}

 onDestroy(resource.dispose);
 const activity=$derived(resource.data?.activity);
 const panels=$derived(activity?[...profileActivityPanels(activity.days,activity.today,period,href.split('?')[0]),...profileBreakdownPanels(activity.genres,activity.ratings,period,href.split('?')[0])]:[]);
 const row=$derived(target&&'source' in target?target.source:undefined);
 const source=$derived(row?.type==='discovery'?{...row,mediums:{...page.data,features:page.data.capabilities}}:row);
</script>
<div class="content section-page">
 {#if source}<Shelf {source} hideEmpty={false} />
 {:else if selection?.section==='favourites'}<Shelf title="Favourites" layout="grid" items={resource.data.items} availability={false} hideEmpty={false} busy={!resource.ready||resource.busy} error={resource.error} retry={()=>void load()} onactivate={()=>void load()} hasMore={resource.data.page<resource.data.pages} onend={()=>void load(resource.data.page+1,true)}>
  {#snippet segments(style)}<SegmentedControl {...style} label="Favourite media type" value={kind} options={mediaTypeOptions({...page.data,features:page.data.capabilities})} onchange={value=>{kind=value;void load();}} />{/snippet}
 </Shelf>
 {:else if selection}<Shelf title="Activity, in perspective" size="panel" layout="grid" itemCount={resource.ready?panels.length+1:0} artworkOptions={false} hideEmpty={false} busy={!resource.ready||resource.busy} error={resource.error} retry={()=>void load()} onactivate={()=>void load()}>
  {#snippet segments(style)}<SegmentedControl {...style} label="Profile statistics period" value={period} options={[{value:'month',label:'Month'},{value:'year',label:'Year'},{value:'all',label:'All time'}]} onchange={value=>{period=value as typeof period;void load();}} />{/snippet}
  {#snippet children()}
   {#if resource.data.totals}<DetailCard title="Summary">
    {#if activity}<ProfileRecap subject={selection.username} movies={activity.days.reduce((n,d)=>n+d.movies,0)} episodes={activity.days.reduce((n,d)=>n+d.episodes,0)} seasons={activity.completedSeasons} previousCount={activity.previousCount} {period} />{/if}
    <MetricGrid items={[{label:'Unique titles',value:resource.data.totals.unique},{label:'Recorded watches',value:resource.data.totals.watches},{label:'Unique episodes',value:resource.data.totals.episodes},{label:'Rated titles',value:resource.data.totals.rated}]} />
   </DetailCard>{/if}
   {#each panels as panel}<DetailCard {...panel} />{/each}
  {/snippet}
 </Shelf>{/if}
</div>
<style>.section-page {padding-top:72px;padding-bottom:96px;}</style>
