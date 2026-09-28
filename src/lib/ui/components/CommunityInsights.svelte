<script lang="ts">
  import type { MediaInsights } from '$lib/media/details';
  import BarChart from './BarChart.svelte';
  import MetricGrid from './MetricGrid.svelte';
  import BreakdownChart from './BreakdownChart.svelte';
  import DetailCard from './DetailCard.svelte';
  let { details }: { details: MediaInsights } = $props();
</script>

{#if details.rating !== undefined}<DetailCard
    title={`${details.source} rating`}
    description="Community score"
  >
    <BreakdownChart
      label={`${details.source} score out of ten`}
      centre={details.rating.toFixed(1)}
      unit="out of 10"
      showLegend={false}
      items={[
        { label: 'Score', value: details.rating },
        { label: 'Remaining', value: 10 - details.rating, tone: '#353b44' },
      ]}
    />
    {#snippet footer()}<a href={details.url} target="_blank" rel="noreferrer"
        >{(details.votes ?? 0).toLocaleString()} votes · View on {details.source} ↗</a
      >{/snippet}
  </DetailCard>{/if}
{#if details.ratingDistribution?.some((r) => r.count > 0)}<DetailCard
    title="How viewers rate it"
    description={`${details.source} · scores out of 10`}
  >
    <BarChart
      label={`${details.source} rating distribution`}
      items={details.ratingDistribution.map((r) => ({
        label: String(r.value),
        detail: `${r.value} out of 10`,
        value: r.count,
      }))}
      summary={`${(details.votes ?? details.ratingDistribution.reduce((sum, r) => sum + r.count, 0)).toLocaleString()} votes`}
      caption="Community ratings"
      axis
    />
  </DetailCard>{/if}
{#if details.metrics?.length}<DetailCard
    title="Community activity"
    description={`Across ${details.source}`}><MetricGrid items={details.metrics} /></DetailCard
  >{/if}
