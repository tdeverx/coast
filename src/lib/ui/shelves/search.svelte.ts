import { untrack } from 'svelte';
import { page } from '$app/state';
import { invalidate } from '$app/navigation';
import { libraryTitles, librarySelections, type LibrarySurface } from '$lib/library';
import type { ShelfItem, ShelfSource, ShelfControl } from './types';
export type SearchOptions = {
  surface: LibrarySurface;
  query: string;
  items: ShelfItem[];
  busy?: boolean;
  failure?: string;
  truncated?: boolean;
  layout?: 'row' | 'grid';
};
export function createSearchSource(getOptions: () => SearchOptions): ShelfSource {
  let { surface, query, items, busy = false, failure = '', truncated = false, layout = 'row' } = $derived(getOptions());
  let kind = $state(untrack(() => layout === 'grid' ? page.url.searchParams.get('kind') ?? 'all' : 'all'));
  return {
    get pagination() { return { kind: 'local' as const }; },
    get title() { return libraryTitles[surface]; },
    get items() { return surface === 'watch' ? items : items.filter(item => 'href' in item && (kind === 'all' || item.kind === kind)); },
    get busy() { return busy; }, get ready() { return !busy; }, get error() { return failure; }, activated: true,
    get href() { return layout === 'row' ? '/search?' + new URLSearchParams({q:query,view:surface,kind}) : undefined; },
    get filterBy() { return surface === 'watch' ? 'type' : 'none'; },
    filters: [], get controls(): ShelfControl[] { return surface === 'listen' ? [{type:'select',label:'Listen type',value:kind,options:librarySelections.listen,change:value=>{kind=value;}}] : []; },
    rows: 2,
    get shape() { return surface === 'watch' ? undefined : surface === 'listen' ? 'square' : 'poster'; },
    get mediaKind() { return surface === 'listen' ? 'music' : surface === 'play' ? 'game' : 'screen'; },
    get notice() { return truncated ? 'Refine your search for more results.' : ''; },
    get empty() { return busy ? 'Searching…' : 'No titles in this selection.'; },
    load: async () => invalidate('coast:tracking'),
  };
}
