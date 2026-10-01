export interface ChartDatum {
  label: string;
  value: number;
  href?: string;
  detail?: string;
  tone?: string;
}
export const chartTones = [
  'var(--ink)',
  'var(--muted)',
  'var(--quiet)',
  'color-mix(in srgb, var(--quiet) 80%, var(--canvas))',
  'color-mix(in srgb, var(--quiet) 60%, var(--canvas))',
  'var(--line)',
  'var(--surface-hover)',
];
export const chartValue = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
