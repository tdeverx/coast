import type { ComponentProps } from 'svelte';
import type { ChartModel } from '../charts/model';
import type FactList from '../components/FactList.svelte';
import type MetricGrid from '../components/MetricGrid.svelte';
export type InsightContent =
  | { kind: 'chart'; model:ChartModel }
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
