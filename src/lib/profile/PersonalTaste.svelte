<script lang="ts">
  import {page} from '$app/state';
  import type {personalTaste} from '#lib/social/taste-cache.server.js';
  import {tasteMedia} from '#lib/social/taste-profile.js';
  import Heading from '#lib/ui/components/Heading.svelte';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import TasteSignals from './TasteSignals.svelte';
  let {data}:{data:Awaited<ReturnType<typeof personalTaste>>}=$props();
  const date=new Intl.DateTimeFormat(undefined,{dateStyle:'medium'});
  const count=new Intl.NumberFormat();
  const rating=new Intl.NumberFormat(undefined,{maximumFractionDigits:2});
  const activityLabels={
    movie:['watched','rewatched'],show:['watched','rewatched'],music:['played','played again'],
    game:['played','replayed'],book:['read','reread'],comic:['read','reread'],
  } as const;
  const media=$derived(tasteMedia.filter(({category})=>page.data.capabilities[category]));
  let selected=$state('');
  const active=$derived(media.find(item=>item.value===selected)??media.find(item=>data.some(row=>row.medium===item.value&&row.works>0))??media[0]);
  const profile=$derived(data.find(row=>row.medium===active?.value));
</script>
<section class="section" aria-label="Your taste">
  <Heading variant="row" title="Your taste" selection={active && {
    label:'Personal taste medium',options:media.map(({value,label})=>({value,label})),value:active.value,change:value=>selected=value,
  }}/>
  {#if active}
    <MetricGrid items={[
      {label:'Works considered',value:profile?.works ?? null,detail:profile?.works
        ? `${count.format(profile.consumedWorks)} ${activityLabels[active.value][0]} · ${count.format(profile.repeatedWorks)} ${activityLabels[active.value][1]}` : undefined},
      {label:'Works with signals',value:profile?.worksWithSignals ?? null,
        detail:profile?.worksWithSignals ? `${count.format(profile.explicitWorks)} from feedback · ${count.format(profile.inferredWorks)} from activity` : undefined},
      {label:'Median rating',value:profile?.medianRating == null ? null : `${rating.format(profile.medianRating)} / 5`,
        detail:profile?.ratings ? (profile.ratings === 1 ? '1 rated work' : `${count.format(profile.ratings)} rated works`) : undefined},
      {label:'Last refreshed',value:profile ? date.format(new Date(profile.updatedAt)) : null,text:true},
    ]} />
    {#key active.value}<TasteSignals medium={active.value}/>{/key}
  {:else}<p class="quiet">Taste signals will appear when a media type is available.</p>{/if}
</section>
<style>
  .section { display: grid; gap: var(--gutter); }
  .section > :global(.row-header) { margin-bottom: 0; }
  @media (min-width: 900px) {
    .section > :global(.metrics) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
</style>
