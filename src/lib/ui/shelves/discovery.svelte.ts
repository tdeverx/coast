import { onDestroy, untrack } from 'svelte';
import { page } from '$app/state';
import { goto, replaceState } from '$app/navigation';
import { useClient } from '$lib/ui/client-context';
import { createResource } from '$lib/ui/resource.svelte';
import { readingTypeOptions } from '$lib/ui/filter-options';
import { discoverySegments, discoveryTitles, type DiscoveryContent, type DiscoverySurface, type DiscoverySection } from '$lib/discovery';
import type { ShelfSource, ShelfControl, ShelfPagination } from './types';

export type DiscoveryOptions = {
  type: 'discovery'; section: DiscoverySection; initial?: DiscoveryContent;
  surface?: DiscoverySurface; kind?: 'all' | 'book' | 'comic'; page?: number;
  mediums?: import('$lib/experimental').MediumFeatures; layout?: 'row' | 'grid';
};
export function createDiscoverySource(get: () => DiscoveryOptions): ShelfSource {
  const { api } = useClient();
  const initial = untrack(get);
  let surface = $state<DiscoverySurface>(initial.surface ?? 'watch');
  let kind = $state<string>(initial.kind ?? 'all'), available = $state(false), currentPage = $state(initial.page ?? 1);
  const resource = createResource<DiscoveryContent>(initial.initial ?? { items: [], failure: '' }, !!initial.initial);
  const cached = new Map<string, DiscoveryContent>();
  const title = $derived(discoveryTitles[get().section]);
  function cacheKey() { return surface === 'read' ? `${surface}:${kind}:${currentPage}` : surface; }
  function remember(result: DiscoveryContent) {
    if (result.failure) return;
    cached.set(cacheKey(), result);
    while (cached.size > 20) cached.delete(cached.keys().next().value!);
  }
  resource.error = initial.initial?.failure ?? '';
  if (initial.initial) remember(initial.initial);
  function parameters(number = currentPage) {
    return new URLSearchParams({ section: get().section, surface, ...(surface === 'read' ? { kind, page: String(number) } : {}) });
  }
  function pageUrl(number: number) { return `/discover?${parameters(number)}`; }
  async function load() {
    const key = cacheKey();
    const previous = cached.get(key);
    if (previous) { resource.replace(previous, previous.failure); return; }
    const result = await resource.load(signal => api<DiscoveryContent>(`discover?${parameters()}`, undefined, 'GET', { signal }), { failure: result => result.failure });
    if (result && key === cacheKey()) remember(result);
  }
  function select(value: string) {
    if (value === surface) return;
    surface = value as DiscoverySurface; kind = 'all'; currentPage = 1; available = false;
    if (get().layout === 'grid') replaceState(pageUrl(1), page.state);
    resource.replace({ items: [], failure: '' }); void load();
  }
  function selectKind(value: string) {
    kind = value; currentPage = 1;
    if (get().layout === 'grid') { void goto(pageUrl(1), { keepFocus: true, noScroll: true }); return; }
    resource.replace({ items: [], failure: '' }); void load();
  }
  $effect(() => {
    const option = get(), current = option.initial;
    untrack(() => {
      if (current && surface === (option.surface ?? 'watch')) {
        resource.replace(current, current.failure); remember(current);
      }
    });
  });
  $effect(() => {
    const features=get().mediums;
    if(surface!=='read')return;
    if(!features?.experimentalBooks && !features?.experimentalComics){
      untrack(()=>{resource.cancel();cached.clear();surface='watch';kind='all';currentPage=1;resource.replace({items:[],failure:''});void load();});
    }else if(kind==='book'&&!features.experimentalBooks || kind==='comic'&&!features.experimentalComics){
      untrack(()=>selectKind('all'));
    }
  });
  onDestroy(resource.cancel);
  return {
    get pagination(): ShelfPagination { return surface === 'read' && get().layout === 'grid' ? { kind: 'pages', page: resource.data.page ?? currentPage, pages: resource.data.pages ?? 1, append: false, controls: 'footer', url: pageUrl } : { kind: 'local' }; },
    get title() { return title; },
    get items() { return resource.data.items.filter(item => (surface === 'read' || kind === 'all' || item.kind === kind) && (surface === 'read' || !available || item.available)); },
    get busy() { return resource.busy; }, get ready() { return resource.ready; }, get error() { return resource.error; }, get activated() { return resource.activated; },
    get href() { return get().layout === 'grid' ? undefined : pageUrl(1); },
    get shape() { return surface === 'listen' ? 'square' : 'poster'; },
    get mediaKind() { return surface === 'read' ? 'reading' : surface === 'listen' ? 'music' : surface === 'play' ? 'game' : 'screen'; },
    get resetKey() { return `${surface}:${kind}:${available}:${currentPage}`; },
    get filters(): ShelfControl[] { return [
      { type: 'segments', label: `${title} medium`, value: surface, options: discoverySegments.filter(option => option.value === 'watch' || option.value === 'play' && get().mediums?.experimentalGaming || option.value === 'listen' && get().mediums?.experimentalMusic || option.value === 'read' && (get().mediums?.experimentalBooks || get().mediums?.experimentalComics)), change: select },
      ...(surface === 'read' ? [{ type: 'select' as const, label: 'Reading type', value: kind, options: readingTypeOptions(get().mediums ?? {}), change: selectKind }] : [{ type: 'availability' as const, label: 'Available to play only', value: available ? 'available' : 'all', change: (value: string) => { available = value === 'available'; } }]),
    ]; },
    get controls(): ShelfControl[] { return surface === 'watch' ? [{ type: 'media-type', label: `${title} type`, value: kind, change: value => { kind = value; } }] : []; },
    actions: [],
    get notice() { return resource.data.notice; },
    get empty() { return resource.busy ? 'Loading titles…' : available ? 'No available titles in this selection.' : surface === 'listen' ? 'No music in this selection yet.' : surface === 'play' ? 'No games in this selection yet.' : 'No titles in this selection.'; },
    load,
  };
}
