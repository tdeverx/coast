<script lang="ts">
  import { periodLabel, type ProfilePeriod } from '$lib/profile/period';
  import DetailCard from './DetailCard.svelte';
  import BreakdownChart from './BreakdownChart.svelte';
  import BarChart from './BarChart.svelte';
  let {
    profileUrl = '/profile',
    genres,
    ratings,
    period,
  }: {
    profileUrl?: string;
    genres: { name: string; count: number; filter: string }[];
    ratings: { value: number; count: number }[];
    period: ProfilePeriod;
  } = $props();
  const ratingCount = $derived(ratings.reduce((sum, r) => sum + r.count, 0));
  const average = $derived(
    ratingCount ? ratings.reduce((sum, r) => sum + r.value * r.count, 0) / ratingCount : 0
  );
  const genreItems = $derived(
    genres.map((g) => ({
      label: g.name,
      value: g.count,
      href: `${profileUrl}?view=history&period=${period}&genre=${encodeURIComponent(g.filter)}`,
    }))
  );
  const ratingItems = $derived(
    Array.from({ length: 10 }, (_, i) => {
      const value = (i + 1) / 2;
      return {
        label: String(value),
        detail: `${value} stars`,
        value: ratings.find((r) => r.value === value)?.count ?? 0,
        href: `${profileUrl}?view=ratings&period=${period}&rating=${value}`,
      };
    })
  );
</script>

<DetailCard title="Most-watched genres" description={periodLabel(period)}>
  <BreakdownChart items={genreItems} label="Watched genres" unit="genre credits" />
  {#snippet footer()}Titles can count in more than one genre. Select a genre to explore its titles.{/snippet}
</DetailCard>
<DetailCard title="Your ratings" description={periodLabel(period)}>
  <BarChart
    items={ratingItems}
    label="Your rating distribution"
    summary={ratingCount ? `${average.toFixed(1)} / 5` : 'No ratings yet'}
    caption={`${ratingCount} rated titles`}
    axis
    empty="Rate a title to start your rating chart."
  />
</DetailCard>
