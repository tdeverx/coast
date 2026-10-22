import { untrack } from 'svelte';
import { page } from '$app/state';
import { libraryTitles, type LibrarySurface } from '#lib/library.js';
import type { ShelfItem, ShelfSource, ShelfControl } from './types';
import type { MediumFeatures } from '#lib/experimental.js';
import { mediaTypeOptions } from '#lib/ui/filter-options.js';
import { refreshRouteDependencies } from '#lib/ui/client.js';
import { searchRowMatches, searchSurface, type SearchView } from '#lib/search-selection.js';

export type SearchOptions = {
  surface?: LibrarySurface;
  bucket?: 'available' | 'unavailable';
  query: string;
  items: ShelfItem[];
  layout?: 'row' | 'grid';
  kind?: string;
  view?: SearchView;
  onKindChange?: (value: string) => void;
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
  const kind = $derived(options.onKindChange ? options.kind ?? 'all' : localKind);
  function selectKind(value: string) {
    if (options.onKindChange) options.onKindChange(value);
    else localKind = value;
  }
  return {
    pagination: { kind: 'local' },
    get title() { return options.bucket === 'available' ? 'Available' : options.bucket === 'unavailable' ? 'Unavailable' : libraryTitles[options.surface ?? 'watch']; },
    get items() {
      return options.items.filter(item =>
        searchRowMatches({ kind, view: options.view }, item.kind) &&
        (!options.bucket || (item.available === true) === (options.bucket === 'available')));
    },
    get shape(){return options.view==='listen'?'square' as const:'poster' as const;},
    get busy() { return options.busy ?? false; },
    get ready() { return !options.busy; },
    get error() { return options.failure ?? ''; },
    activated: true,
    filterBy: 'none',
    get filters(): ShelfControl[] {
      return [{ type: 'segments', label: `${this.title} media type`, value: kind,
        options: [...mediaTypeOptions(options.mediums ?? page.data), ...((options.mediums ?? page.data).experimentalMusic ? [{ value: 'artist', label: 'Artists' }] : [])].filter(option=>option.value==='all'||!options.view||options.view==='all'||searchSurface(option.value)===options.view), change: selectKind }];
    },
    controls: [],
    actions: [],
    rows: 1,
    get resetKey() { return `${options.query}:${options.view ?? 'all'}:${kind}`; },
    get notice() { return options.notice || (options.truncated ? 'Refine your search for more results.' : ''); },
    get empty() { return options.bucket === 'available' ? 'No available titles match this search.' : 'No unavailable titles match this search.'; },
    load: async () => refreshRouteDependencies(['tracking', 'reading', 'providers']),
  };
}
