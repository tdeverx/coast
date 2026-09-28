<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { ProfilePeriod } from '$lib/profile/period';
  import type { MediaStatistics } from '$lib/media/statistics';
  import { api, message } from '$lib/ui/client';
  import DetailCard from './DetailCard.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import MetricGrid from './MetricGrid.svelte';
  import Button from './Button.svelte';
  let { mediaId, period }: { mediaId: string; period: ProfilePeriod } = $props();
  let data = $state<MediaStatistics | null>(null),
    error = $state('');
  let loadedPeriod = $state(untrack(() => period));
  let controller: AbortController | undefined;
  async function load(id: string, selected: ProfilePeriod) {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    error = '';
    try {
      const result = await api<MediaStatistics>(
        `media/${id}/statistics?period=${selected}`,
        undefined,
        'GET',
        { signal: request.signal }
      );
      if (!request.signal.aborted) {
        data = result;
        loadedPeriod = selected;
      }
    } catch (cause) {
      if (!request.signal.aborted) error = message(cause);
    }
  }
  $effect(() => {
    const id = mediaId,
      selected = period;
    untrack(() => {
      void load(id, selected);
    });
  });
  onDestroy(() => controller?.abort());
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : '—';
</script>

{#if error}<DetailCard title="Activity unavailable"
    ><p role="alert">{error}</p>
    <Button variant="ghost" onclick={() => load(mediaId, period)}>Try again</Button></DetailCard
  >{/if}
{#if data}{@const result = data}<DetailCard title="Watching activity"
    ><ActivityChart
      days={result.days}
      today={result.today}
      period={loadedPeriod}
    />{#snippet footer()}Completed watches, including rewatches. Dates use UTC.{#if result.undated}
        {result.undated} undated watches are included in totals, but not plotted.{/if}{/snippet}</DetailCard
  >
  <DetailCard title="Your history"
    ><MetricGrid
      items={[
        { label: 'Recorded watches', value: result.watches },
        { label: 'Unique titles', value: result.unique },
        { label: 'First watch', value: date(result.first), text: true },
        { label: 'Last watch', value: date(result.last), text: true },
      ]}
    /></DetailCard
  >{/if}
