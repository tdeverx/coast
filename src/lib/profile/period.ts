export type ProfilePeriod = 'month' | 'year' | 'all';
export const periodLabel = (period: ProfilePeriod) =>
  period === 'month' ? 'Last 30 days' : period === 'year' ? 'Last 365 days' : 'All time';
export function periodStart(period: ProfilePeriod, now = new Date()) {
  if (period === 'all') return undefined;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - ((period === 'month' ? 30 : 365) - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
}
