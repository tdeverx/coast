import type { InsightPanel } from './types';
/** Metadata from any category shares the same About/Details presentation. */
export function overviewPanels(overview: string | null | undefined, facts: {label:string;value:string}[]): InsightPanel[] {
  return [
    ...(overview ? [{ title:'About', content:{kind:'text' as const,text:overview} }] : []),
    ...(facts.length ? [{ title:'Details', content:{kind:'facts' as const,props:{items:facts}} }] : []),
  ];
}
