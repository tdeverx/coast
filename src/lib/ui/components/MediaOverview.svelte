<script lang="ts">
  import type { MediaView } from '$lib/ui/types';
  import DetailCard from './DetailCard.svelte';
  import MetricGrid from './MetricGrid.svelte';
  import BreakdownChart from './BreakdownChart.svelte';
  import ProgressChart from './ProgressChart.svelte';
  let {
    item,
    members = [],
    seasons = [],
  }: { item: MediaView; members?: MediaView[]; seasons?: MediaView[] } = $props();
  const group = $derived(['show', 'season', 'collection'].includes(item.kind));
  const total = $derived(members.length || item.totalEpisodes || 0);
  const completed = $derived(
    Math.min(
      total,
      members.length ? members.filter((m) => m.watched).length : item.completedEpisodes || 0
    )
  );
  const partial = $derived(members.filter((m) => !m.watched && m.progress > 0).length);
  const available = $derived(members.filter((m) => m.available).length);
  const minutes = $derived(members.reduce((n, m) => n + (m.runtimeMinutes ?? 0), 0));
  const duration = $derived(item.duration || (item.runtimeMinutes ?? 0) * 60);
  const position = $derived(
    item.progress > 0 ? Math.min(duration, item.progress) : item.watched ? duration : 0
  );
  const percent = $derived(
    duration ? Math.round((position / duration) * 100) : item.watched ? 100 : 0
  );
  const unit = $derived(item.kind === 'collection' ? 'titles' : 'episodes');
  const progressItems = $derived(
    group
      ? [
          { label: 'Watched', value: completed },
          ...(members.length ? [{ label: 'In progress', value: partial }] : []),
          {
            label: members.length ? 'Not started' : 'Unwatched',
            tone: '#353b44',
            value: Math.max(0, total - completed - partial),
          },
        ]
      : [
          { label: 'Played', value: position / 60 },
          {
            label: 'Remaining',
            tone: '#353b44',
            value: Math.max(0, (duration - position) / 60),
          },
        ]
  );
  const seasonItems = $derived(
    seasons.map((s) => ({
      label: s.title,
      value: s.completedEpisodes ?? 0,
      total: s.totalEpisodes || undefined,
      href: `/media/${s.id}`,
    }))
  );
  const runtime = (value: number) =>
    value < 60 ? `${value}m` : `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ''}`;
  const metrics = $derived([
    ...(group
      ? [
          {
            label: `${unit[0].toUpperCase() + unit.slice(1)} watched`,
            value: `${completed} / ${total}`,
          },
        ]
      : [{ label: 'Play count', value: item.playCount }]),
    ...(members.length ? [{ label: 'In your library', value: `${available} / ${total}` }] : []),
    ...(minutes || item.runtimeMinutes
      ? [
          {
            label: group ? 'Total runtime' : 'Runtime',
            value: runtime(minutes || item.runtimeMinutes!),
          },
        ]
      : []),
    {
      label: 'Your rating',
      value: item.rating ? `${item.rating} / 5` : '—',
      detail: item.rating ? undefined : 'Not rated',
    },
  ]);
</script>

<DetailCard
  title={group ? 'Completion' : 'Playback progress'}
  description={group
    ? `Across ${total} ${unit}`
    : item.progress > 0 && position < duration
      ? 'Your saved resume point'
      : item.watched
        ? 'Marked as watched'
        : 'Not started'}
>
  {#if (group && total) || duration}<BreakdownChart
      label={group ? 'Viewing completion' : 'Playback progress'}
      items={progressItems}
      centre={`${group ? Math.round((completed / Math.max(1, total)) * 100) : percent}%`}
      unit={group ? 'watched' : 'played'}
    />
  {:else}<p class="muted">
      {group
        ? 'No episodes or titles have been added yet.'
        : 'Progress will appear when a playback duration is available.'}
    </p>{/if}
  {#snippet footer()}{group
      ? 'Completion reflects your current watched state. Rewatches stay in your history.'
      : 'Playback is measured in minutes. Recorded plays and viewing history are kept separately.'}{/snippet}
</DetailCard>
<DetailCard title="At a glance"><MetricGrid items={metrics} /></DetailCard>
{#if seasonItems.length}<DetailCard
    title="Season progress"
    description="Episodes watched in each season"
    ><ProgressChart label="Season progress" items={seasonItems} /></DetailCard
  >{/if}
