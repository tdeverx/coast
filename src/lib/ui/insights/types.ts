import type { ComponentProps } from 'svelte';
import type BarChart from '../components/BarChart.svelte';
import type BreakdownChart from '../components/BreakdownChart.svelte';
import type ProgressChart from '../components/ProgressChart.svelte';
import type FactList from '../components/FactList.svelte';
import type MetricGrid from '../components/MetricGrid.svelte';
export type InsightContent =
  | { kind: 'bar'; props: ComponentProps<typeof BarChart> }
  | { kind: 'breakdown'; props: ComponentProps<typeof BreakdownChart> }
  | { kind: 'progress'; props: ComponentProps<typeof ProgressChart> }
  | { kind: 'facts'; props: ComponentProps<typeof FactList> }
  | { kind: 'metrics'; props: ComponentProps<typeof MetricGrid> }
  | { kind: 'text'; text: string; muted?: boolean };
export type InsightPanel = {
  title: string;
  description?: string;
  content: InsightContent;
  footerText?: string;
  footerLink?: { href: string; label: string; external?: boolean };
};
