import { surfaceEnabled } from '$lib/experimental';
import { onDestroy, untrack } from 'svelte';
import { page } from '$app/state';
import { goto, replaceState } from '$app/navigation';
import { useClient } from '$lib/ui/client-context';
import { createResource } from '$lib/ui/resource.svelte';
import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
import { readingTypeOptions } from '$lib/ui/filter-options';
import { discoverySegments, discoveryTitles, type DiscoveryContent, type DiscoverySurface, type DiscoverySection } from '$lib/discovery';
import type { ShelfSource, ShelfControl, ShelfPagination } from './types';
export type DiscoveryOptions = {
  type: 'discovery';
  section: DiscoverySection;
  initial?: DiscoveryContent;
  surface?: DiscoverySurface;
  kind?: 'all' | 'book' | 'comic';
  page?: number;
  mediums?: import('$lib/experimental').MediumFeatures;
  layout?: 'row' | 'grid';
};
export function createDiscoverySource(get: () => DiscoveryOptions): ShelfSource {
  const { api, preview } = useClient();
  const initial = untrack(get);
  let surface = $state<DiscoverySurface>(initial.surface ?? 'watch');
  let kind = $state<string>(initial.kind ?? 'all');
  let available = $state(false);
  let currentPage = $state(initial.page ?? 1);
  const resource = createResource<DiscoveryContent>(initial.initial ?? { items: [], failure: '' }, !!initial.initial);
  const cached = new Map<string, DiscoveryContent>();
  const title = $derived(discoveryTitles[get().section]);
  function cacheKey() { return surface === 'read' ? `${surface}:${kind}:${currentPage}` : surface; }
  function remember(result: DiscoveryContent) {
    if (result.failure)
      return;
    cached.set(cacheKey(), result);
    while (cached.size > 20)
      cached.delete(cached.keys().next().value!);
  }
  resource.error = initial.initial?.failure ?? '';
  if (initial.initial)
    remember(initial.initial);
  function parameters(number = currentPage) {
    return new URLSearchParams({ section: get().section, surface, ...(surface === 'read' ? { kind, page: String(number) } : {}) });
  }
  function pageUrl(number: number) { return `/discover?${parameters(number)}`; }
  async function load() {
    if(!surfaceAvailable(surface)){
      resource.replace({items:[],failure:''});
      return;
    }
    const key = cacheKey();
    const result = await resource.load(signal => api<DiscoveryContent>(`discover?${parameters()}`, undefined, 'GET', { signal }), { failure: result => result.failure });
    if (result && key === cacheKey())
      remember(result);
  }
  function restoreOrLoad() {
    const previous = cached.get(cacheKey());
    if (previous)
      resource.replace(previous, previous.failure);
    else
      void load();
  }
  function surfaceAvailable(value:string) {
    return surfaceEnabled({...get().mediums, experimentalMusic:get().mediums?.experimentalMusic??false,experimentalGaming:get().mediums?.experimentalGaming??false,experimentalBooks:get().mediums?.experimentalBooks??false,experimentalComics:get().mediums?.experimentalComics??false},value);
  }

  function select(value: string) {
    if (value === surface || !surfaceAvailable(value))
      return;
    surface = value as DiscoverySurface;
    kind = 'all';
    currentPage = 1;
    available = false;
    if (!preview && get().layout === 'grid')
      replaceState(pageUrl(1), page.state);
    resource.replace({ items: [], failure: '' });
    restoreOrLoad();
  }
  function selectKind(value: string) {
    kind = value;
    currentPage = 1;
    if (!preview && get().layout === 'grid') {
      void goto(pageUrl(1), { keepFocus: true, noScroll: true });
      return;
    }
    resource.replace({ items: [], failure: '' });
    restoreOrLoad();
  }
  const refreshKey = $derived(JSON.stringify([
    contentRevisionKey(page.data, ['tracking', 'social']), get().section,
    get().mediums?.experimentalMusic, get().mediums?.experimentalGaming,
    get().mediums?.experimentalBooks, get().mediums?.experimentalComics,
  ]));
  let previousRefresh = untrack(() => refreshKey);
  let previousInitial = initial.initial;
  let previousSelection = JSON.stringify([initial.surface ?? 'watch', initial.kind ?? 'all', initial.page ?? 1]);
  $effect(() => {
    const option = get();
    const current = option.initial;
    const key = refreshKey;
    const selection = JSON.stringify([option.surface ?? 'watch', option.kind ?? 'all', option.page ?? 1]);
    // Inline option objects can be recreated by an unchanged session update.
    // The actual SSR items and scalar result fields define replacement data.
    const initialChanged = current?.items !== previousInitial?.items
      || current?.failure !== previousInitial?.failure
      || current?.notice !== previousInitial?.notice
      || current?.page !== previousInitial?.page
      || current?.pages !== previousInitial?.pages
      || current?.total !== previousInitial?.total;
    untrack(() => {
      const changed = key !== previousRefresh || initialChanged || selection !== previousSelection;
      if (selection !== previousSelection) {
        surface = option.surface ?? 'watch';
        kind = option.kind ?? 'all';
        currentPage = option.page ?? 1;
        available = false;
      }
      previousRefresh = key;
      previousInitial = current;
      previousSelection = selection;
      const withdrawn = !surfaceAvailable(surface);
      if (withdrawn) {
        surface = discoverySegments.find(option=>surfaceAvailable(option.value))?.value as DiscoverySurface??'watch';
        kind = 'all';
        currentPage = 1;
        available = false;
      }
      const features = option.mediums;
      const kindWithdrawn = surface === 'read' && (
        kind === 'book' && !features?.experimentalBooks
        || kind === 'comic' && !features?.experimentalComics
      );
      if (kindWithdrawn) {
        kind = 'all';
        currentPage = 1;
      }
      if (!preview && (withdrawn || kindWithdrawn) && option.layout === 'grid')
        replaceState(pageUrl(currentPage), page.state);
      if (!changed && !withdrawn && !kindWithdrawn)
        return;
      const activated = resource.activated || resource.ready;
      cached.clear();
      resource.cancel();
      if (
        initialChanged && current && surface === (option.surface ?? 'watch')
        && (surface !== 'read' || kind === (option.kind ?? 'all') && currentPage === (option.page ?? 1))
      ) {
        resource.replace(current, current.failure);
        remember(current);
      } else if (activated) {
        resource.replace({ items: [], failure: '' });
        void load();
      }
    });
  });
  onDestroy(resource.dispose);
  return {
    get pagination(): ShelfPagination {
      return surface === 'read' && get().layout === 'grid'
        ? {
            kind: 'pages', page: resource.data.page ?? currentPage,
            pages: resource.data.pages ?? 1, append: false, controls: 'footer', url: pageUrl,
          }
        : { kind: 'local' };
    },
    get title() { return title; },
    get items() {
      return resource.data.items.filter(item =>
        (surface === 'read' || kind === 'all' || item.kind === kind)
        && (surface === 'read' || !available || item.available)
      );
    },
    get busy() { return resource.busy; },
    get ready() { return resource.ready; },
    get error() { return resource.error; },
    get activated() { return resource.activated; },
    get href() { return get().layout === 'grid' ? undefined : pageUrl(1); },
    get shape() { return surface === 'listen' ? 'square' : 'poster'; },
    get mediaKind() { return surface === 'read' ? 'reading' : surface === 'listen' ? 'music' : surface === 'play' ? 'game' : 'screen'; },
    get resetKey() { return `${surface}:${kind}:${available}:${currentPage}`; },
    get filters(): ShelfControl[] {
      return [
        {
          type: 'segments', label: `${title} medium`, value: surface,
          options: discoverySegments.filter(option =>
            option.value === 'watch' && surfaceAvailable('watch')
            || option.value === 'play' && get().mediums?.experimentalGaming
            || option.value === 'listen' && get().mediums?.experimentalMusic
            || option.value === 'read' && (get().mediums?.experimentalBooks || get().mediums?.experimentalComics)
          ),
          change: select,
        },
        ...(surface === 'read'
          ? [{
              type: 'select' as const, label: 'Reading type', value: kind,
              options: readingTypeOptions(get().mediums ?? {}), change: selectKind,
            }]
          : [{
              type: 'availability' as const, label: 'Available to play only',
              value: available ? 'available' : 'all',
              change: (value: string) => { available = value === 'available'; },
            }]),
      ];
    },
    get controls(): ShelfControl[] {
      return surface === 'watch'
        ? [{ type: 'media-type', label: `${title} type`, value: kind, change: value => { kind = value; } }]
        : [];
    },
    actions: [],
    get notice() { return resource.data.notice; },
    get empty() {
      return resource.busy ? 'Loading titles…'
        : available ? 'No available titles in this selection.'
        : surface === 'listen' ? 'No music in this selection yet.'
        : surface === 'play' ? 'No games in this selection yet.'
        : 'No titles in this selection.';
    },
    load,
  };
}
