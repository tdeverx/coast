<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { categoryEnabled } from '#lib/experimental.js';
  import type { personalTaste } from '#lib/social/taste-cache.server.js';
  import { tasteDimensions, tasteMedia, type TasteAffinity, type TasteDimension } from '#lib/social/taste-profile.js';
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
  const strength = new Intl.NumberFormat(undefined,{style:'percent',signDisplay:'exceptZero'});
  const media = $derived(tasteMedia.filter(({category}) => categoryEnabled({ ...page.data, features: page.data.capabilities }, category)));
  let selected = $state('');
  const active = $derived(media.find(({value}) => value === selected) ?? media.find(({value}) => data.some(profile => profile.medium === value && profile.works > 0)) ?? media[0]);
  const profile = $derived(data.find(({medium}) => medium === active?.value));
  const signalRows = $derived(tasteDimensions.map(dimension => ({
    dimension,
    label: dimension === 'writers' && (active?.category === 'book' || active?.category === 'comic')
      ? 'Authors' : displayLabel(dimension),
    value: profile?.signals[dimension]?.names.join(', ') ?? null,
    count: profile?.signals[dimension]?.count ?? 0,
  })));
  const signalFacts = $derived(signalRows.map(row=>({
    ...row, detail:row.count > 3 ? `Showing 3 of ${row.count}` : undefined,
  })));
  let dimension = $state<TasteDimension>('genres');
  let open = $state(false);
  let currentPage = $state(1);
  const browser = createResource<{items:TasteAffinity[];pages:number}>({items:[],pages:1});
  const browseTitle = $derived(signalRows.find(row => row.dimension === dimension)?.label ?? 'Signals');
  onDestroy(browser.dispose);

  function load(number: number) {
    if (!active) return;
    currentPage = number;
    const params = new URLSearchParams({medium:active.value, dimension, page:String(number)});
    return browser.load(signal => api(`profile/taste-affinities?${params}`, undefined, 'GET', {signal}));
  }

  function browse(value: TasteDimension) {
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
        <Button menu text="Browse saved signals" label="Browse saved signals" disabled={!signalRows.some(row => row.count > 0)}>
          {#each signalRows as row (row.dimension)}
            <Button item text={row.label} disabled={row.count === 0} onclick={() => browse(row.dimension)} />
          {/each}
        </Button>
      {/if}
    {/snippet}
  </Heading>
  {#if active}
    <MetricGrid items={[
      {label:'Titles considered',value:profile?.works ?? null},
      {label:'Last refreshed',value:profile ? date.format(new Date(profile.updatedAt)) : null,text:true},
    ]} />
    <DetailCard title={`${active.label} signals`}>
      <div class="taste-facts">
        <FactList items={signalFacts.slice(0,8)} />
        <FactList items={signalFacts.slice(8)} />
      </div>
    </DetailCard>
  {:else}
    <p class="quiet" role="status">Taste signals will appear when a media type is available.</p>
  {/if}
</section>

{#if open}
  <Dialog bind:open title={browseTitle} onclose={() => browser.cancel()}>
    {#if browser.busy}
      <p role="status">Loading saved signals…</p>
    {:else if browser.error}
      <p role="alert">{browser.error}</p>
      <Button onclick={() => void load(currentPage)}>Retry</Button>
    {:else if browser.data.items.length}
      <FactList items={browser.data.items.map(affinity => ({
        label:affinity.name,
        value:strength.format(affinity.value),
        detail:affinity.samples === 1 ? '1 contributing title' : `${affinity.samples} contributing titles`,
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
</style>
