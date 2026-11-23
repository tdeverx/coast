<script lang="ts">
  import { page } from '$app/state';
  import type { ProfileTaste } from '#lib/profile/details.server.js';
  import { comparisonMedia, comparisonSignals, tasteSignalLabel } from '#lib/social/taste.js';
  import { tasteMedia } from '#lib/social/taste-profile.js';
  import Heading from '#lib/ui/components/Heading.svelte';
  import DetailCard from '#lib/ui/components/DetailCard.svelte';
  import FactList from '#lib/ui/components/FactList.svelte';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import RowFilter from '#lib/ui/components/RowFilter.svelte';
  import Shelf from '#lib/ui/components/Shelf.svelte';

  let { data, href, navigate }: {
    data: ProfileTaste;
    href: string;
    navigate: (href: string) => void;
  } = $props();

  const enabledMedia=$derived(comparisonMedia.filter(option=>page.data.capabilities[option.category]));
  const media = $derived(enabledMedia.flatMap(option => {
    const result = data.comparison.media.find(({ medium }) => medium === option.value);
    return result ? [{ ...result, label: option.label }] : [];
  }));
  const mediumOptions = $derived([{ value: 'all', label: 'All media' },
    ...media.map(({ medium:value, label }) => ({ value, label }))]);
  let selected = $state('');
  const active = $derived(media.find(({medium}) => medium === (selected || data.medium))
    ?? media.find(item => item.score !== null || item.stats.you.total || item.stats.friend.total) ?? media[0]);
  const tasteMedium = $derived(tasteMedia.find(option => option.comparison === active?.medium)?.value);
  const activityVerb = $derived(tasteMedium==='game'?'played':tasteMedium==='music'?'listened to':tasteMedium==='book'||tasteMedium==='comic'?'read':'watched');
  const activityLabels = {total:'Tracked',completed:'Completed',active:'In progress',planned:'Planned',dropped:'Dropped',rated:'Rated',reacted:'Reacted'} as const;
  const progressById = $derived(new Map(data.comparison.media.flatMap(item=>item.progressComparisons)
    .map(progress => [progress.workId, progress] as const)));
  const score = (value: number | null | undefined) => value == null ? null : `${Math.round(value)}%`;
  const progressLabel = (value: number | null) => value === null ? 'Unknown' : `${Math.round(value)}%`;

  function destination(medium: string, overlap: string, number = 1) {
    const url = new URL(href, page.url.href);
    if (medium !== 'all') url.searchParams.set('medium', medium);
    if (overlap !== 'shared') url.searchParams.set('overlap', overlap);
    if (number > 1) url.searchParams.set('page', String(number));
    return url.pathname + url.search;
  }
</script>

<section class="section">
  <Heading variant="row" title="Taste & overlap" selection={active && {
    label:'Comparison medium',options:media.map(({medium:value,label})=>({value,label})),value:active.medium,
    change:value => { selected = value; },
  }} />
  <MetricGrid items={[
    { label: 'Overall taste agreement', value: score(data.comparison.score), detail: 'Median across qualifying media' },
    { label: active ? `${active.label} taste agreement` : 'Taste agreement', value: score(active?.score) },
  ]} />
  {#if active}
    <div class="taste-cards">
      <DetailCard title={`${active.label} signals`} description={`Preferences use up to ${data.comparison.sampleLimit} independently chosen works per person and medium. Rating agreement includes every shared opinion.`}>
        <FactList items={comparisonSignals(active.medium).map(name => {
          const signal = active.signals[name];
          return {
            label:tasteSignalLabel(name,tasteMedium),
            value:score(signal?.score),
            detail:signal && (signal.left || signal.right || signal.shared)
              ? `${signal.shared} shared · ${signal.left} yours · ${signal.right} theirs`
              : undefined,
          };
        })} />
      </DetailCard>
      <div class="taste-counts">
        <DetailCard title="Shared preferences">
          <FactList items={[
            {label:'Preference agreement',value:score(active.comparison.preferences.score),detail:`${active.comparison.preferences.traits} comparable traits`},
            ...active.comparison.preferences.examples.map(trait=>({label:trait.name,value:`${trait.you}% / ${trait.friend}%`,detail:'You / friend'})),
          ]}/>
        </DetailCard>
        <DetailCard title="Activity" description="You / friend">
          <FactList items={Object.entries(activityLabels).map(([key,label]) => {
            const stat = key as keyof typeof activityLabels;
            const yours = active.stats.you.total ? active.stats.you[stat].toLocaleString() : '—';
            const theirs = active.stats.friend.total ? active.stats.friend[stat].toLocaleString() : '—';
            return {label,value:active.stats.you.total || active.stats.friend.total ? `${yours} / ${theirs}` : null};
          })} />
        </DetailCard>
        <DetailCard title="Overlap">
          <FactList items={[
            {label:`Both ${activityVerb}`,value:active.comparison.viewing.shared.toLocaleString()},
            {label:`Only you ${activityVerb}`,value:active.comparison.viewing.onlyYou.toLocaleString()},
            {label:`Only your friend ${activityVerb}`,value:active.comparison.viewing.onlyFriend.toLocaleString()},
            {label:'Shared items',value:active.stats.you.total || active.stats.friend.total ? active.overlapCounts.shared.toLocaleString() : null},
            {label:'Only you',value:active.stats.you.total ? active.overlapCounts.onlyYou.toLocaleString() : null},
            {label:'Only your friend',value:active.stats.friend.total ? active.overlapCounts.onlyFriend.toLocaleString() : null},
          ]} />
        </DetailCard>
      </div>
    </div>
  {/if}
</section>

<Shelf title="Overlap & progress" items={data.items} layout="grid" hideEmpty={false}
  pageNumber={data.comparison.page} pages={data.comparison.pages}
  pageUrl={number => destination(data.medium, data.overlap, number)}>
  {#snippet heading()}
    <Heading variant="title" title="Overlap & progress" />
    <span class="small muted">{data.comparison.total.toLocaleString()} {data.comparison.total === 1 ? 'title' : 'titles'}</span>
  {/snippet}
  {#snippet controls()}
    <RowFilter groups={[
      { label: 'Overlap medium', value: data.medium, options: mediumOptions,
        change: value => navigate(destination(value, data.overlap)) },
      { label: 'Overlap relationship', value: data.overlap, options: [
        { value: 'shared', label: 'Shared items' },
        { value: 'onlyYou', label: 'Only you' },
        { value: 'onlyFriend', label: 'Only your friend' },
      ], change: value => navigate(destination(data.medium, value)) },
    ]} reset={{ disabled: data.medium === 'all' && data.overlap === 'shared',
      run: () => navigate(destination('all', 'shared')) }} />
  {/snippet}
  {#snippet details(item)}
    {@const progress = progressById.get(('workId' in item ? item.workId : undefined) ?? item.id)}
    {#if progress}
      <p class="small">Progress · You <span class:muted={progress.you === null}>{progressLabel(progress.you)}</span>
        · Friend <span class:muted={progress.friend === null}>{progressLabel(progress.friend)}</span></p>
    {/if}
  {/snippet}
</Shelf>

<style>
  .section, .taste-cards, .taste-counts { display: grid; gap: var(--gutter); }
  .section > :global(.row-header) { margin-bottom: 0; }
  .taste-cards { grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); align-items: start; }
</style>
