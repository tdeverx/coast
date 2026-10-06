import { chartCategoryColor, chartMediumColor } from '$lib/ui/charts/types';
export { chartColors, chartCategoryColor, chartFill } from '$lib/ui/charts/types';

export interface ChartRow {
  label: string;
  value: number | null;
  values?: (number | null)[];
  reference?: number;
  valueUnit?: string;
  referenceUnit?: string;
  capacity?: number;
  detail?: string;
  evidence?: number;
  medium?: string;
  group?: string;
}
export interface ChartSeries { name: string; tone?: string; values: (number | null)[] }
export interface ChartPoint { label: string; x: number; y: number; group?: string; detail?: string }
export interface ChartEvent { label: string; day: number; detail: string; state?: string; date?: string }
export interface ChartFlow { source: string; target: string; value: number }
export interface ChartModel {
  id: string;
  styleId: string;
  title: string;
  subtitle: string;
  unit: string;
  notes: string[];
  labels: string[];
  rows: ChartRow[];
  series: ChartSeries[];
  points: ChartPoint[];
  events: ChartEvent[];
  flows: ChartFlow[];
  matrix: (number | null)[][];
  domain: [number, number];
  domainY: [number, number];
  ticks: number[];
  ticksY: number[];
  xLabel: string;
  yLabel: string;
  total?: number;
  symbolUnit?: number;
  calendar?: { year: number; month: number; values: (number | null)[] };
  interval?: { min: number; q1: number; median: number; q3: number; max: number; current?: number };
  raw: Record<string, unknown>;
}
export function mediumColor(medium?: string, label = '') {
  return chartMediumColor(medium) ?? chartCategoryColor(label);
}
export function formatValue(value: number | null, unit = '') {
  return value === null ? 'Unknown' : `${Number(value.toFixed(2)).toLocaleString('en-GB')}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}
