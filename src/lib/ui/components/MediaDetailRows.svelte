<script lang="ts">
 import Shelf from './Shelf.svelte';
 import MediaCard from './MediaCard.svelte';
 import DetailCard from './DetailCard.svelte';
 import Button from './Button.svelte';
 import RowFilter from './RowFilter.svelte';
 import SegmentedControl from './SegmentedControl.svelte';
 import type {DetailRowsModel,DetailFailure} from '../pages/detail-rows';
 let {model,section}:{model:DetailRowsModel;section?:string|null}=$props();
 const insight=$derived(model.insights?.tabs.find(tab=>tab.value===model.insights?.selection));
 const credit=$derived(model.credits?.groups.find(group=>group.value===model.credits?.selection));
</script>
{#snippet errors(items:DetailFailure[]=[])}
 {#each items as failure}<DetailCard title={failure.title}><p>{failure.message}</p><Button emphasis="subtle" onclick={failure.retry}>Try again</Button></DetailCard>{/each}
{/snippet}
{#if model.credits&&(!section||section==='credits')}
 <Shelf title="Credits" size="circle" artworkOptions={false} preserveHeight layout={section?'grid':'row'} href={!section?model.credits.href:undefined} onactivate={model.credits.activate} itemCount={(credit?.people.length??0)+(model.credits.errors?.length??0)} hideEmpty={model.credits.hideEmpty??false} busy={credit?.busy}>
  {#snippet segments(style)}{#if model.credits!.groups.length>1}<SegmentedControl {...style} label="Credits selection" value={model.credits!.selection} onchange={model.credits!.select} options={model.credits!.groups.map(({value,label})=>({value,label}))} />{/if}{/snippet}
  {#snippet children(style)}{#each credit?.people??[] as person(person.id)}<MediaCard item={person} shape={style.shape} artworkStyle={style.artworkStyle} overlay={style.overlay}/>{/each}{@render errors(model.credits!.errors)}{/snippet}
 </Shelf>
{/if}
{#if model.reviews&&(!section||section==='reviews')}
 <Shelf title="Reviews" size="panel" artworkOptions={false} preserveHeight layout={section?'grid':'row'} href={!section?model.reviews.href:undefined} onactivate={model.reviews.activate} busy={model.reviews.busy} itemCount={model.reviews.items.length+model.reviews.errors.length} hideEmpty={model.reviews.selection==='all'}>
  {#snippet controls()}{#if model.reviews!.options.length>1}<RowFilter groups={[{label:'Review source',value:model.reviews!.selection,options:model.reviews!.options,change:value=>model.reviews!.select?.(value)}]} />{/if}{/snippet}
  {#snippet children()}
   {#each model.reviews!.items as review(`${review.source}:${review.id}`)}<DetailCard title={review.author} description={[review.source,review.date?.slice(0,10),review.rating===undefined?'':`${review.rating} / 10`].filter(Boolean).join(' · ')}>
    <details class="review"><summary>{review.spoiler?'Reveal spoiler review':'Read review'}</summary><p>{review.text}</p></details>
    {#snippet footer()}<a href={review.url} target="_blank" rel="noreferrer">View on {review.source} ↗</a>{/snippet}
   </DetailCard>{/each}
   {@render errors(model.reviews!.errors)}
   {#if model.reviews!.more}<Button emphasis="subtle" disabled={model.reviews!.busy} onclick={model.reviews!.more}>Load more reviews</Button>{/if}
  {/snippet}
 </Shelf>
{/if}
{#if model.insights&&(!section||section==='insights'||section==='activity'&&model.insights.tabs.some(tab=>tab.value==='activity'))}
 <Shelf title="Insights" size="panel" artworkOptions={false} preserveHeight layout={section?'grid':'row'} href={!section?model.insights.href:undefined} onactivate={model.insights.activate} busy={insight?.busy}>
  {#snippet segments(style)}{#if model.insights!.tabs.length>1}<SegmentedControl {...style} label="Insights selection" value={model.insights!.selection} onchange={model.insights!.select} options={model.insights!.tabs.map(({value,label})=>({value,label}))} />{/if}{/snippet}
  {#snippet controls()}{#if insight?.filters?.length}<RowFilter groups={insight.filters} />{/if}{/snippet}
  {#snippet children()}
   {#each insight?.panels??[] as panel}<DetailCard {...panel} />{/each}
   {@render insight?.content?.()}{@render errors(insight?.errors)}
  {/snippet}
 </Shelf>
{/if}
<style>
 .review summary{cursor:pointer;font-size:var(--text-sm);font-weight:var(--weight-semibold);}
 .review p{font-size:var(--text-sm);line-height:var(--leading-relaxed);white-space:pre-line;overflow-wrap:anywhere;max-height:300px;overflow:auto;margin-top:12px;}
</style>
