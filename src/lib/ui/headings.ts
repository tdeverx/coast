import { goto } from '$app/navigation';
import type { FilterOption } from './filter-options';
export type HeadingSelection = {
  label: string;
  value: string;
  options: FilterOption[];
  change: (value: string) => unknown;
};
/** Keep browse routing and feature gates outside the heading renderer. */
export function browseHeading(surface: 'watch' | 'listen' | 'play', enabled: boolean) {
  return {
    title: 'Library',
    level: 1 as const,
    selection: enabled ? {
      label: 'Library media', value: surface,
      options: [{value:'watch',label:'Watch'},{value:'listen',label:'Listen'},{value:'play',label:'Play'}],
      change: (value: string) => { void goto(value === 'watch' ? '/library' : value === 'listen' ? '/music' : '/games'); },
    } : undefined,
  };
}
