<script lang="ts">
  import { activityBuckets, type ActivityDay } from '$lib/profile/activity';
  import { periodLabel, type ProfilePeriod } from '$lib/profile/period';
  import BarChart from './BarChart.svelte';
  let {
    days,
    today,
    period,
    href,
  }: {
    days: ActivityDay[];
    today: string;
    period: ProfilePeriod;
    href?: (from: string, to: string) => string;
  } = $props();
  const buckets = $derived(activityBuckets(days, today, period));
  const date = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const total = $derived(buckets.reduce((sum, day) => sum + day.movies + day.episodes, 0));
  const annual = $derived(
    period === 'all' && Date.parse(today) - Date.parse(buckets[0].date) > 730 * 86400000
  );
  const axisDate = (day: string) =>
    annual
      ? day.slice(0, 4)
      : period === 'year'
        ? new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
            month: 'short',
            year: '2-digit',
            timeZone: 'UTC',
          })
        : date(day);
  const points = $derived(
    buckets.map((day) => ({
      label: axisDate(day.date),
      detail: `${day.date}${day.end !== day.date ? ` – ${day.end}` : ''} · ${day.movies} movies, ${day.episodes} episodes`,
      value: day.movies + day.episodes,
      href: href?.(day.date, day.end),
    }))
  );
</script>

<BarChart
  items={points}
  label="Watching activity"
  summary={`${total.toLocaleString()} ${total === 1 ? 'watch' : 'watches'}`}
  caption={periodLabel(period)}
/>
