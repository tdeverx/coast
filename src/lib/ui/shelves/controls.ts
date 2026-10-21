import type { FilterGroup } from '#lib/ui/controls/filters.js';
import { mediaTypeOptions } from '#lib/ui/filter-options.js';
import type { ShelfControl } from './types';

/** One placement rule for every source: segments and availability beside the title, secondary choices in the menu. */
export function shelfControls(controls: ShelfControl[], select: (control: ShelfControl, value: string) => void) {
  return {
    segments: controls.filter(control => control.type === 'segments'),
    availability: controls.filter(control => control.type === 'availability'),
    groups: controls.filter(control => control.type !== 'segments' && control.type !== 'availability').map((control): FilterGroup => ({
      label: control.label,
      value: control.value,
      options: control.type === 'media-type' ? mediaTypeOptions(control.mediums)
        : control.type === 'collection' ? [{value:'all',label:'All library titles'},{value:'collection',label:'In my Collection'}]
        : control.options ?? [],
      change: value => select(control, value),
    })),
  };
}
