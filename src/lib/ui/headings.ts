import { goto } from '$app/navigation';
import { surfaceEnabled, type MediumFeatures } from '$lib/experimental';
import type { FilterOption } from './filter-options';
export type HeadingSelection = {
  label: string;
  value: string;
  options: FilterOption[];
  change: (value: string) => unknown;
};
/** Keep browse routing and feature gates outside the heading renderer. */
export function browseHeading(surface: 'watch' | 'listen' | 'play' | 'read', config: MediumFeatures) {
  return {
    title: 'Library',
    level: 1 as const,
    selection: surfaceEnabled(config,surface) ? {
      label: 'Library media', value: surface,
      options: [{value:'watch',label:'Watch'},{value:'listen',label:'Listen'},{value:'play',label:'Play'},{value:'read',label:'Read'}].filter(option=>surfaceEnabled(config,option.value)),
      change: (value: string) => { void goto(value === 'watch' ? '/library' : value === 'listen' ? '/music' : value==='play' ? '/games' : '/library?view=read'); },
    } : undefined,
  };
}
