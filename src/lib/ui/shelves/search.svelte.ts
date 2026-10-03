import { untrack } from 'svelte';
import { page } from '$app/state';
import { invalidate, replaceState } from '$app/navigation';
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
  function selectKind(value:string){kind=value;if(layout==='grid'){const url=new URL(page.url);url.searchParams.set('kind',value);replaceState(url.pathname+url.search,page.state);}}
  let available = $state(untrack(() => layout === 'grid' && page.url.searchParams.get('rowAvailable') === 'true'));
  function selectAvailable(value:string){available=value==='available';if(layout==='grid'){const url=new URL(page.url);url.searchParams.set('rowAvailable',String(available));replaceState(url.pathname+url.search,page.state);}}
  return {
    get pagination() { return { kind: 'local' as const }; },
    get title() { return libraryTitles[surface]; },
    get items() { return surface === 'watch' ? items : items.filter(item => 'href' in item && (kind === 'all' || item.kind === kind) && (!available || item.available)); },
    get busy() { return busy; }, get ready() { return !busy; }, get error() { return failure; }, activated: true,
    get href() { return layout === 'row' ? '/search?' + new URLSearchParams({q:query,view:surface,kind,rowAvailable:String(available)}) : undefined; },
    get filterBy() { return surface === 'watch' ? 'type' : 'none'; },
    get filters(): ShelfControl[] {return surface==='watch'?[]:[...(surface==='listen'?[{type:'segments' as const,label:'Listen type',value:kind,options:librarySelections.listen,change:selectKind}]:[]),{type:'availability',label:'Available to play only',value:available?'available':'all',change:selectAvailable}];}, controls: [],
    rows: 2,
    get shape() { return surface === 'watch' ? undefined : surface === 'listen' ? 'square' : 'poster'; },
    get mediaKind() { return surface === 'listen' ? 'music' : surface === 'play' ? 'game' : 'screen'; },
    get notice() { return truncated ? 'Refine your search for more results.' : ''; },
    get empty() { return busy ? 'Searching…' : surface==='play' && available ? 'No owned games match this selection. Turn off Available to browse all games.' : 'No titles in this selection.'; },
    load: async () => invalidate('coast:tracking'),
  };
}
