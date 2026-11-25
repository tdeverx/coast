import {useShelfLocation} from '#lib/ui/detail-section.svelte.js';
import { surfaceEnabled, categoryEnabled } from '#lib/experimental.js';
import { onDestroy, untrack } from 'svelte';
import { page } from '$app/state';
import { goto } from '$app/navigation';
import { useClient } from '#lib/ui/client-context.js';
import { createResource,uniqueItems } from '#lib/ui/resource.svelte.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
import { readingTypeOptions } from '#lib/ui/filter-options.js';
import { discoverySegments, discoveryTitles, type DiscoveryContent, type DiscoverySurface, type DiscoverySection } from '#lib/discovery.js';
import type { ShelfSource, ShelfControl, ShelfPagination } from './types';
import { createShelfRefresh } from './refresh.svelte.js';
export type DiscoveryOptions = {
  scoped?:boolean;
  type: 'discovery';
  section: DiscoverySection;
  initial?: DiscoveryContent;
  surface?: DiscoverySurface;
  kind?: 'all' | 'book' | 'comic';
  page?: number;
  mediums?: import('#lib/experimental.js').MediumFeatures;
  layout?: 'row' | 'grid';
};
export function createDiscoverySource(get: () => DiscoveryOptions, refreshVisible?: () => boolean): ShelfSource {
 const location=useShelfLocation();
  const { api, preview } = useClient();
  const initial = untrack(get);
  const mediums = $derived(get().mediums ?? { ...page.data, features: page.data.capabilities });
  let surface = $state<DiscoverySurface>(initial.surface ?? 'watch');
  function canFilterAvailability() {
    return !!page.data.user && (surface === 'watch' || surface === 'play');
  }
  function watchKind() {
    const value = get().layout === 'grid' ? location.url?.searchParams.get('rowKind') : null;
    return value === 'movie' || value === 'show' ? value : 'all';
  }
  let kind = $state<string>(surface === 'watch' ? watchKind() : initial.kind ?? 'all');
  let available = $state(canFilterAvailability() && initial.layout === 'grid' && location.url?.searchParams.get('rowAvailable') === 'true');
  let currentPage = $state(initial.page ?? 1);
  const resource = createResource<DiscoveryContent>(initial.initial ?? { items: [], failure: '' }, !!initial.initial);
  const cached = new Map<string, DiscoveryContent>();
  let emptySurfaces = $state<DiscoverySurface[]>([]);
  const title = $derived(discoveryTitles[get().section]);
  function cacheKey() { return surface === 'read' ? `${surface}:${kind}:${currentPage}` : surface; }
  function remember(result: DiscoveryContent) {
    if (result.failure)
      return;
    cached.set(cacheKey(), result);
    if (surface !== 'read' || kind === 'all' && currentPage === 1) {
      const previouslyEmpty = emptySurfaces.filter(value => value !== surface);
      emptySurfaces = result.items.length ? previouslyEmpty : [...previouslyEmpty, surface];
    }
    while (cached.size > 20)
      cached.delete(cached.keys().next().value!);
  }
  resource.error = initial.initial?.failure ?? '';
  if (initial.initial)
    remember(initial.initial);
  function parameters(number = currentPage) {
    return new URLSearchParams({
      section: get().section,
      surface,
      ...surface === 'read' ? { kind, page: String(number) } : {}
    });
  }
  function pageUrl(number: number) {
    const params=parameters(number);
    params.set('view',surface);
    params.delete('surface');
    if (surface === 'watch' && kind !== 'all') params.set('rowKind', kind);
    if (canFilterAvailability() && available) params.set('rowAvailable', 'true');
    return `/discover?${params}`;
  }
  function updateGridLocation() {
    if (!location.embedded && !preview && get().layout === 'grid')
      void location.replace(pageUrl(currentPage));
  }
  const refresh = createShelfRefresh(() => load(), refreshVisible);
  async function load(number=get().layout==='grid'?currentPage:1,append=false) {
    refresh.clear();
    currentPage=number;
    if(!surfaceAvailable(surface)){
      resource.replace({items:[],failure:''});
      return;
    }
    const key = cacheKey();

    const result = await resource.load((signal) => api<DiscoveryContent>(`discover?${parameters()}`, undefined, 'GET', { signal }), {
      failure: (result) => result.failure,
      merge: (old, next) => ({
        ...next,
        items: append
          ? uniqueItems([...old.items, ...next.items], (item) => item.entryId ?? item.id)
          : next.items
      })
    });

    if (result && key === cacheKey()) remember(result);
  }
  function restoreOrLoad() {
    const previous = cached.get(cacheKey());
    if (previous) {
      refresh.clear();
      resource.replace(previous, previous.failure);
    } else
      void load();
  }
  function surfaceAvailable(value:string) {
    return surfaceEnabled(mediums, value);
  }

  function select(value: string) {
    if (value === surface || !surfaceAvailable(value))
      return;
    surface = value as DiscoverySurface;
    kind = 'all';
    currentPage = 1;
    available = false;

    updateGridLocation();

    resource.replace({ items: [], failure: '' });
    restoreOrLoad();
  }
  function selectKind(value: string) {
    kind = value;
    currentPage = 1;
    if (!location.embedded && !preview && get().layout === 'grid') {
      void goto(pageUrl(1), { reset: false, });
      return;
    }
    resource.replace({ items: [], failure: '' });
    restoreOrLoad();
  }
  const scopeKey = $derived(JSON.stringify([
    page.data.user?.id, get().section,
    mediums.experimentalMusic, mediums.experimentalGaming,
    mediums.experimentalBooks, mediums.experimentalComics,
    mediums.features,
  ]));
  const refreshKey = $derived(contentRevisionKey(page.data, ['tracking', 'social']));
  let previousScope = untrack(() => scopeKey);
  let previousRefresh = untrack(() => refreshKey);
  let previousInitial = initial.initial;
  let previousSelection = JSON.stringify([initial.surface ?? 'watch', initial.kind ?? 'all', initial.page ?? 1]);
  $effect(() => {
    const option = get();
    const current = option.initial;
    const key = refreshKey;
    const scope = scopeKey;
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
      const scopeChanged = scope !== previousScope || selection !== previousSelection;
      const changed = key !== previousRefresh || initialChanged || scopeChanged;
      if (selection !== previousSelection) {
        surface = option.surface ?? 'watch';
        kind = surface === 'watch' ? watchKind() : option.kind ?? 'all';
        currentPage = option.page ?? 1;
        available = canFilterAvailability() && option.layout === 'grid' && location.url?.searchParams.get('rowAvailable') === 'true';
      }
      previousRefresh = key;
      previousScope = scope;
      previousInitial = current;
      previousSelection = selection;
      const withdrawn = !surfaceAvailable(surface);
      if (!canFilterAvailability()) available = false;
      if(withdrawn&&option.scoped){
        cached.clear();
        emptySurfaces = [];
        refresh.clear();
        resource.replace({items:[],failure:''});
        return;
      }
      if (withdrawn) {
        surface = discoverySegments.find((option) => surfaceAvailable(option.value))?.value as DiscoverySurface ?? 'watch';
        kind = 'all';
        currentPage = 1;
        available = false;
      }
      const kindWithdrawn = surface === 'read' && (
        (kind === 'book' || kind === 'comic') && !categoryEnabled(mediums, kind)
      );
      if (kindWithdrawn) {
        kind = 'all';
        currentPage = 1;
      }

      if (withdrawn || kindWithdrawn) updateGridLocation();
      if (!changed && !withdrawn && !kindWithdrawn) return;

      const activated = resource.activated || resource.ready;
      cached.clear();
      emptySurfaces = [];
      if (
        initialChanged && current && surface === (option.surface ?? 'watch')
        && (surface !== 'read' || kind === (option.kind ?? 'all') && currentPage === (option.page ?? 1))
      ) {
        refresh.clear();
        resource.replace(current, current.failure);
        remember(current);
      } else if (activated) {
        if (!refreshVisible || scopeChanged || withdrawn || kindWithdrawn) resource.replace({ items: [], failure: '' });
        refresh.invalidate();
      }
    });
  });
  onDestroy(resource.dispose);
  return {
    get filterReset() {
      return { disabled: kind === 'all' && !available, run: () => {
        const reload = surface === 'read' && kind !== 'all';
        kind = 'all';
        available = false;
        currentPage = 1;
        updateGridLocation();
        if (reload) {
          resource.replace({ items: [], failure: '' });
          restoreOrLoad();
        }
      } };
    },
    get pagination(): ShelfPagination {
      return surface === 'read'
        ? {
            kind: 'pages', page: resource.data.page ?? currentPage,
            pages: resource.data.pages ?? 1, append: get().layout!=='grid', controls: get().layout==='grid'?'footer':'none', url: pageUrl,
          }
        : { kind: 'local' };
    },
    get title() { return title; },
    get items() {
      return resource.data.items.filter((item) => (surface === 'read' || kind === 'all' || item.kind === kind) && (surface === 'read' || !available || item.available));
    },
    get busy() { return resource.busy; },
    get ready() { return resource.ready; },
    get error() { return resource.error; },
    get activated() { return resource.activated; },
    get href() { return get().layout === 'grid' ? undefined : pageUrl(1); },
    get shape() { return surface === 'listen' ? 'square' : 'poster'; },
    get mediaKind() { return surface === 'read' ? 'reading' : surface === 'listen' ? 'music' : surface === 'play' ? 'game' : 'screen'; },
    get resetKey() { return `${surface}:${kind}:${available}${get().layout==='grid'?':'+currentPage:''}`; },
    get filters(): ShelfControl[] {
      return [
        ...get().scoped?[]:[{
          type: 'segments' as const,
          label: `${title} medium`,
          value: surface,
          options: discoverySegments.filter(option => surfaceAvailable(option.value))
            .map(option => ({ ...option, disabled: emptySurfaces.some(value => value === option.value) })),
          change: select
        }],

        ...surface === 'read'
          ? [
            {
              type: 'select' as const,
              label: 'Reading type',
              value: kind,
              options: readingTypeOptions(mediums),
              change: selectKind
            }
          ]
          : canFilterAvailability() ? [
            {
              type: 'availability' as const,
              label: surface === 'play' ? 'Owned only' : 'Available to watch only',
              value: available ? 'available' : 'all',
              change: (value: string) => {
                available = value === 'available';
                updateGridLocation();
              }
            }
          ] : []
      ];
    },
    get controls(): ShelfControl[] {
      return surface === 'watch'
        ? [
          {
            type: 'media-type',
            label: 'Media type',
            value: kind,
            change: (value) => {
              kind = value;
              updateGridLocation();
            }
          }
        ]
        : [];
    },
    actions: [],
    get empty() {
      return resource.busy ? 'Loading titles…'
        : available ? 'No available titles in this selection.'
        : !resource.data.items.length && resource.data.notice ? resource.data.notice
        : surface === 'listen' ? 'No music in this selection yet.'
        : surface === 'play' ? 'No games in this selection yet.'
        : 'No titles in this selection.';
    },
    load,
  };
}
