export type ChartContext = 'P' | 'T' | 'S' | 'M';
export type ChartMedium = 'Benchmarks' | 'Screen' | 'Movies' | 'Shows' | 'Games' | 'Music';
export type ChartDataset = 'A' | 'B';
export interface ChartStyle {
  id: string;
  name: string;
  family: string;
  contexts: ChartContext[];
  variantIds: string[];
  sourceImage: string;
  knownApproximations: string[];
}
export interface ChartFixture {
  id: string;
  sourceId: string;
  context: ChartContext;
  variant: ChartDataset;
  title: string;
  supportedMediums: string[];
  semanticData: Record<string, unknown>;
  knownApproximations: string[];
}
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
export interface ChartSeries { name: string; values: (number | null)[] }
export interface ChartPoint { label: string; x: number; y: number; group?: string; detail?: string }
export interface ChartEvent { label: string; day: number; detail: string; state?: string; date?: string }
export interface ChartFlow { source: string; target: string; value: number }
export interface ChartModel {
  fixtureId: string;
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
export const chartColors = ['var(--accent)', 'var(--success)', 'var(--danger)', 'var(--rating)'];
export function mediumColor(medium?: string, index = 0) {
  const value = medium?.toLowerCase();
  return value === 'music' ? 'var(--danger)' : value === 'game' || value === 'games' ? 'var(--success)' : value === 'screen' || value === 'movies' || value === 'shows' ? 'var(--accent)' : chartColors[index % chartColors.length];
}
export function formatValue(value: number | null, unit = '') {
  return value === null ? 'Unknown' : `${Number(value.toFixed(2)).toLocaleString('en-GB')}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}
