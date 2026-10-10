import { untrack } from 'svelte';
import { page } from '$app/state';
import { libraryTitles, type LibrarySurface } from '$lib/library';
import type { ShelfItem, ShelfSource, ShelfControl } from './types';
import type { MediumFeatures } from '$lib/experimental';
import { mediaTypeOptions } from '$lib/ui/filter-options';
import { refreshRouteDependencies } from '$lib/ui/client';

export type SearchOptions = {
  surface?: LibrarySurface;
  bucket?: 'available' | 'unavailable';
  query: string;
  items: ShelfItem[];
  layout?: 'row' | 'grid';
  kind?: string;
  busy?: boolean;
  failure?: string;
  truncated?: boolean;
  mediums?: Partial<MediumFeatures>;
  notice?: string;
};

/** Both search rows share the same finite, lazy shelf and media-type controls. */
export function createSearchSource(getOptions: () => SearchOptions): ShelfSource {
  let localKind = $state(untrack(() => getOptions().kind ?? 'all'));
  const options = $derived(getOptions());
  const kind = $derived(localKind);
  function selectKind(value: string) {
    localKind = value;
  }
  return {
    pagination: { kind: 'local' },
    get title() { return options.bucket === 'available' ? 'Available' : options.bucket === 'unavailable' ? 'Unavailable' : libraryTitles[options.surface ?? 'watch']; },
    get items() {
      return options.items.filter(item =>
        (kind === 'all' || item.kind === kind) &&
        (!options.bucket || (item.available === true) === (options.bucket === 'available')));
    },
    get busy() { return options.busy ?? false; },
    get ready() { return !options.busy; },
    get error() { return options.failure ?? ''; },
    activated: true,
    filterBy: 'none',
    get filters(): ShelfControl[] {
      return [{ type: 'segments', label: `${this.title} media type`, value: kind,
        options: [...mediaTypeOptions(options.mediums ?? page.data), ...((options.mediums ?? page.data).experimentalMusic ? [{ value: 'artist', label: 'Artists' }] : [])], change: selectKind }];
    },
    controls: [],
    actions: [],
    rows: 1,
    get resetKey() { return `${options.query}:${kind}`; },
    get notice() { return options.notice || (options.truncated ? 'Refine your search for more results.' : ''); },
    get empty() { return options.bucket === 'available' ? 'No available titles match this search.' : 'No unavailable titles match this search.'; },
    load: async () => refreshRouteDependencies(['tracking', 'reading', 'providers']),
  };
}
