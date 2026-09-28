<script lang="ts">
  import type { ActivityDay } from '$lib/profile/activity';
  import type { ProfilePeriod } from '$lib/profile/period';
  import DetailCard from './DetailCard.svelte';
  import ActivityChart from './ActivityChart.svelte';
  import BreakdownChart from './BreakdownChart.svelte';
  let {
    profileUrl = '/profile',
    days,
    today,
    period,
  }: { profileUrl?: string; days: ActivityDay[]; today: string; period: ProfilePeriod } = $props();
  const totals = $derived(
    days.reduce(
      (sum, day) => ({ movies: sum.movies + day.movies, episodes: sum.episodes + day.episodes }),
      { movies: 0, episodes: 0 }
    )
  );
</script>

<DetailCard title="Watching activity">
  <ActivityChart
    {days}
    {today}
    {period}
    href={(from, to) => `${profileUrl}?view=history&period=${period}&from=${from}&to=${to}`}
  />
  {#snippet footer()}Select a bar to view its watches. Dates use UTC.{/snippet}
</DetailCard>
<DetailCard title="Watching mix" description="Recorded watches, including rewatches">
  <BreakdownChart
    label="Watching mix"
    unit="watches"
    items={[
      {
        label: 'Movies',
        value: totals.movies,
        href: `${profileUrl}?view=history&period=${period}&type=movie`,
      },
      {
        label: 'Episodes',
        value: totals.episodes,
        href: `${profileUrl}?view=history&period=${period}&type=episode`,
      },
    ]}
  />
  {#snippet footer()}Based on dated history in this period. Imported history without a date is
    excluded.{/snippet}
</DetailCard>
