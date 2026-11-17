import type { FilterGroup } from '#lib/ui/controls/filters.js';
import { mediaTypeOptions } from '#lib/ui/filter-options.js';
import type { ShelfControl } from './types';

/** Keep navigation segments at the heading and send applicable filters to its menu. */
export function shelfControls(controls: ShelfControl[], select: (control: ShelfControl, value: string) => void) {
  const groups = controls.flatMap((control): FilterGroup[] => {
    if (control.type === 'segments') return [];
    const availability = control.type === 'availability';
    const collection = control.type === 'collection';
    const options = control.type === 'media-type' ? mediaTypeOptions(control.mediums)
      : availability ? [{ value: 'all', label: 'All titles' }, { value: 'available', label: control.label }]
      : collection ? [{ value: 'all', label: 'All titles' }, { value: 'collection', label: control.label }]
      : control.options ?? [];
    if (options.length < 2) return [];
    return [{
      label: control.label,
      section: control.section ?? (availability || collection ? 'access' : 'content'),
      value: control.value,
      options,
      presentation: availability || collection ? 'checkbox' : undefined,
      change: value => select(control, value),
    }];
  });
  return { segments: controls.filter(control => control.type === 'segments'), groups };
}
