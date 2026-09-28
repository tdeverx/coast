export type ActivityDay = { date: string; movies: number; episodes: number };
export function activityBuckets(days: ActivityDay[], today: string, period: string) {
  const earliest = days.map((day) => day.date).sort()[0] ?? today;
  const count =
    period === 'all'
      ? Math.max(1, Math.ceil((Date.parse(today) - Date.parse(earliest)) / 86400000) + 1)
      : period === 'year'
        ? 365
        : period === '90'
          ? 90
          : 30;
  const width = period === 'year' ? 30 : period === '90' ? 7 : 1;
  const end = Date.parse(`${today}T00:00:00Z`);
  const start = end - (count - 1) * 86400000;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const buckets: (ActivityDay & { end: string })[] = [];
  for (let index = 0; index < count; index++) {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    if (
      !buckets.length ||
      (period === 'year' || period === 'all'
        ? buckets[buckets.length - 1].date.slice(0, period === 'all' && count > 730 ? 4 : 7) !==
          date.slice(0, period === 'all' && count > 730 ? 4 : 7)
        : index % width === 0)
    )
      buckets.push({ date, end: date, movies: 0, episodes: 0 });
    const bucket = buckets[buckets.length - 1];
    const day = byDate.get(date);
    bucket.end = date;
    bucket.movies += day?.movies ?? 0;
    bucket.episodes += day?.episodes ?? 0;
  }
  return buckets;
}
