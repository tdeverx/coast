import type { FilterGroup } from '$lib/ui/controls/filters';
import { mediaTypeOptions } from '$lib/ui/filter-options';
import type { ShelfControl } from './types';

/** One placement rule for every source: segments beside the title, secondary choices in the menu. */
export function shelfControls(controls: ShelfControl[], select: (control: ShelfControl, value: string) => void) {
  return {
    segments: controls.filter(control => control.type === 'segments'),
    groups: controls.filter(control => control.type !== 'segments').map((control): FilterGroup => ({
      label: control.label,
      value: control.value,
      options: control.type === 'media-type' ? mediaTypeOptions(control.mediums)
        : control.type === 'availability' ? [{value:'all',label:'All titles'},{value:'available',label:'Available only'}]
        : control.type === 'collection' ? [{value:'all',label:'All library titles'},{value:'collection',label:'In my Collection'}]
        : control.options ?? [],
      change: value => select(control, value),
    })),
  };
}
