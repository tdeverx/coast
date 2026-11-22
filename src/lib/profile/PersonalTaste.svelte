<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import type { personalTaste } from '#lib/social/taste-cache.server.js';
  import { tasteDimensions, tasteMedia, type TasteAffinity, type TasteDimension, type TasteMedium } from '#lib/social/taste-profile.js';
  import { useClient } from '#lib/ui/client-context.js';
  import { displayLabel } from '#lib/ui/labels.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import Button from '#lib/ui/components/Button.svelte';
  import DetailCard from '#lib/ui/components/DetailCard.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import FactList from '#lib/ui/components/FactList.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';

  let { data }: { data: Awaited<ReturnType<typeof personalTaste>> } = $props();
  const { api } = useClient();
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const activityLabels = {
    movie:['watched','rewatched'], show:['watched','rewatched'], music:['played','played again'],
    game:['played','replayed'], book:['read','reread'], comic:['read','reread'],
  } as const;
  function affinityLabel(value: number) {
    if (Math.abs(value) < 0.04) return 'Mixed';
    return value > 0 ? 'Positive' : 'Negative';
  }
  const rating = new Intl.NumberFormat(undefined,{maximumFractionDigits:2});
  const count = new Intl.NumberFormat();
  const percent = new Intl.NumberFormat(undefined, {style:'percent'});
  const affinityPercent = (value: number) => percent.format((1 + value) / 2);
  const columnSize = Math.ceil(tasteDimensions.length / 2);
  function worksLabel(works: number) {
    return works === 1 ? '1 work' : `${count.format(works)} works`;
  }
  const media = $derived(tasteMedia.filter(({category}) => page.data.capabilities[category]));
  let selected = $state('');
  const active = $derived(media.find(({value}) => value === selected) ?? media.find(({value}) => data.some(profile => profile.medium === value && profile.works > 0)) ?? media[0]);
  const profile = $derived(data.find(({medium}) => medium === active?.value));
  const signalRows = $derived(tasteDimensions.map(dimension => ({
    dimension,
    label: dimension === 'writers' && (active?.category === 'book' || active?.category === 'comic')
      ? 'Authors' : displayLabel(dimension),
    value: profile?.signals[dimension]?.preview.map(signal =>
      `${signal.name} ${affinityPercent(signal.value)}`).join(' · ') || null,
    count: profile?.signals[dimension]?.count ?? 0,
  })));
  const signalFacts = $derived(signalRows.map(row=>({
    ...row, detail:row.count > 3 ? `Showing 3 of ${count.format(row.count)}` : undefined,
  })));
  function affinityDetail(affinity:TasteAffinity) {
    const parts = [worksLabel(affinity.samples)];
    if (profile && active && affinity.consumedSamples != null) {
      const [consumed,repeated] = activityLabels[active.value];
      parts.push(`${count.format(affinity.consumedSamples)} of ${count.format(profile.consumedWorks)} ${consumed}`);
      if (affinity.repeatedSamples) parts.push(`${count.format(affinity.repeatedSamples)} ${repeated}`);
    }
    if (affinity.explicitSamples && affinity.positiveFeedbackSamples != null)
      parts.push(`${count.format(affinity.positiveFeedbackSamples)} of ${count.format(affinity.explicitSamples)} with positive feedback`);
    if (affinity.medianRating != null)
      parts.push(`Median rating ${rating.format(affinity.medianRating)} / 5`);
    return parts.join(' · ');
  }
  let dimension = $state<TasteDimension>('genres');
  let open = $state(false);
  let currentPage = $state(1);
  let browsedMedium = $state<TasteMedium>();
  const browser = createResource<{items:TasteAffinity[];pages:number}>({items:[],pages:1});
  const browseTitle = $derived(signalRows.find(row => row.dimension === dimension)?.label ?? 'Signals');
  onDestroy(browser.dispose);

  function closeBrowser() {
    browser.cancel();
    open = false;
    browsedMedium = undefined;
  }
  $effect(() => {
    if (browsedMedium && browsedMedium !== active?.value) closeBrowser();
  });

  function load(number: number) {
    if (!open || !active || active.value !== browsedMedium) return;
    currentPage = number;
    const params = new URLSearchParams({medium:active.value, dimension, page:String(number)});
    return browser.load(signal => api(`profile/taste-affinities?${params}`, undefined, 'GET', {signal}));
  }

  function browse(value: TasteDimension) {
    if (!active) return;
    browsedMedium = active.value;
    dimension = value;
    currentPage = 1;
    browser.replace({items:[],pages:1});
    open = true;
    void load(1);
  }
</script>

<section class="section" aria-label="Your taste">
  <Heading variant="row" title="Your taste" selection={active && {
    label:'Personal taste medium',options:media.map(({value,label})=>({value,label})),value:active.value,
    change:value => selected = value,
  }}>
    {#snippet actions()}
      {#if active}
        <Button menu text="Browse signals" label="Browse signals" disabled={!signalRows.some(row => row.count > 0)}>
          {#each signalRows as row (row.dimension)}
            <Button item text={row.label} disabled={row.count === 0} onclick={() => browse(row.dimension)} />
          {/each}
        </Button>
      {/if}
    {/snippet}
  </Heading>
  {#if active}
    {#if !profile}
      <p class="quiet" role="status">Your taste profile will appear after the background refresh.</p>
    {/if}
    <MetricGrid items={[
      {label:'Works considered',value:profile?.works ?? null,detail:profile?.works
        ? `${count.format(profile.consumedWorks)} ${activityLabels[active.value][0]} · ${count.format(profile.repeatedWorks)} ${activityLabels[active.value][1]}` : undefined},
      {label:'Works with signals',value:profile?.worksWithSignals ?? null,
        detail:profile?.worksWithSignals ? `${count.format(profile.explicitWorks)} from feedback · ${count.format(profile.inferredWorks)} from activity` : undefined},
      {label:'Median rating',value:profile?.medianRating == null ? null : `${rating.format(profile.medianRating)} / 5`,
        detail:profile?.ratings ? (profile.ratings === 1 ? '1 rated work' : `${count.format(profile.ratings)} rated works`) : undefined},
      {label:'Last refreshed',value:profile ? date.format(new Date(profile.updatedAt)) : null,text:true},
    ]} />
    <DetailCard title={`${active.label} signals`} description={profile?.worksWithSignals
      ? '50% is neutral. Signals with stronger evidence appear first.' : undefined}>
      <div class="taste-facts">
        <FactList items={signalFacts.slice(0,columnSize)} />
        <FactList items={signalFacts.slice(columnSize)} />
      </div>
    </DetailCard>
  {:else}
    <p class="quiet" role="status">Taste signals will appear when a media type is available.</p>
  {/if}
</section>

{#if open || browser.activated}
  <Dialog bind:open title={browseTitle} onclose={closeBrowser}>
    {#if browser.busy}
      <p role="status">Loading saved signals…</p>
    {:else if browser.error}
      <p role="alert">{browser.error}</p>
      <Button onclick={() => void load(currentPage)}>Retry</Button>
    {:else if browser.data.items.length}
      <FactList items={browser.data.items.map(affinity => ({
        label:affinity.name,
        value:`${affinityPercent(affinity.value)} · ${affinityLabel(affinity.value)}`,
        detail:affinityDetail(affinity),
      }))} />
      <Pagination page={currentPage} pages={browser.data.pages} label="Saved signal pages" onchange={number => void load(number)} />
    {:else}
      <p class="quiet">No saved signals on this page.</p>
    {/if}
  </Dialog>
{/if}

<style>
  .section, .taste-facts { display: grid; gap: var(--gutter); }
  .section > :global(.row-header) { margin-bottom: 0; }
  .taste-facts { grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
  @media (min-width: 900px) {
    .section > :global(.metrics) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
</style>
