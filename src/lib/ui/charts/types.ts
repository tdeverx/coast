export interface ChartDatum {
  label: string;
  value: number;
  href?: string;
  detail?: string;
  tone?: string;
}
export const chartColors = [
  'var(--chart-series-1)',
  'var(--chart-series-2)',
  'var(--chart-series-3)',
  'var(--chart-series-4)',
];
export const chartTones = [
  ...chartColors,
  'color-mix(in srgb, var(--chart-series-1) 70%, var(--ink))',
  'color-mix(in srgb, var(--chart-series-2) 70%, var(--ink))',
  'color-mix(in srgb, var(--chart-series-3) 70%, var(--ink))',
];
/** Category identity, not ranking position, determines colour across related plots. */
export function chartCategoryColor(label: string) {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/^(movie|movies|screen|watching|recorded watches)$/.test(key)) return chartColors[0];
  if (/^(game|games|playing)$/.test(key)) return chartColors[1];
  if (/^(music|listening|album|albums|track|tracks)$/.test(key)) return chartColors[2];
  if (/^(show|shows|episode|episodes|season|seasons)$/.test(key)) return chartColors[3];
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return chartTones[(hash >>> 0) % chartTones.length];
}
export function chartMediumColor(medium?: string) {
  const key = medium?.toLowerCase();
  return key && /^(screen|movies?|shows?|games?|music)$/.test(key) ? chartCategoryColor(key) : undefined;
}
export const chartFill = (colour: string) => `color-mix(in srgb, ${colour} var(--chart-fill-strength), var(--chart-track))`;
export const chartValue = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
