import {actionFromCategory} from '#lib/actions.js';
import { useShelfLocation } from '#lib/ui/detail-section.svelte.js';
import type { BrowseVariant, GenreReason, DynamicKind } from '#lib/recommendations/model.js';
import { browseRowTitle, catalogueRowTitle, genreRowTitle, recommendationRowTitle } from '#lib/recommendations/row-titles.js';
import { categoryEnabled, mediumOptions } from '#lib/experimental.js';
import { page } from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '#lib/ui/client-context.js';
import { createResource, uniqueItems } from '#lib/ui/resource.svelte.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
import { ApiError } from '#lib/ui/client.js';
import { mediaTypeOptions } from '#lib/ui/filter-options.js';
import type { ShelfSource, ShelfItem, ShelfControl } from './types';
import { createShelfRefresh } from './refresh.svelte.js';

export type RecommendationOptions = {
  type: 'recommendation';
  mode?: 'personal' | 'generic';
  feature: 'row' | 'recommendations' | 'upcoming' | 'browse';
  category?: 'screen' | 'game' | 'music' | 'reading';
  genre?: string;
  kind?: DynamicKind;
  variant?: BrowseVariant;
  available?: boolean;
  reason?: GenreReason;
  workId?: string;
  title?: string;
  seed?: string;
  layout?: 'row' | 'grid'
 };

export function createRecommendationSource(get: () => RecommendationOptions, refreshVisible?: () => boolean): ShelfSource {
  const location = useShelfLocation();
  const { api, preview } = useClient();
  const orderSeed = untrack(() => get().seed ?? location.url.searchParams.get('seed') ?? Math.random().toString(36).slice(2));

  let category = $state(get().category ?? (get().layout === 'grid'
    ? location.url.searchParams.get('category') ?? 'screen'
    : 'screen'));

  const localAvailability = $derived(get().feature === 'browse'
    && ['provider-genre', 'provider-popular', 'provider-rated'].includes(get().variant ?? ''));
  function canFilterAvailability() {
    return (get().feature === 'row' || get().feature === 'recommendations' || localAvailability) && !get().available
      && (get().mode !== 'generic' || !!page.data.user && category !== 'music');
  }
  let available = $state(get().available === true || canFilterAvailability() && get().layout === 'grid'
    && location.url.searchParams.get('available') === 'true');
  const kindOptions = $derived.by(() => {
    if (get().kind || get().mode === 'generic' || (get().feature !== 'row' && get().feature !== 'recommendations')) return [];
    if (category === 'screen') return mediaTypeOptions().filter(option => ['all', 'movie', 'show'].includes(option.value));
    if (category !== 'reading') return [];
    const options = mediaTypeOptions({ ...page.data, features: page.data.capabilities })
      .filter(option => ['all', 'book', 'comic'].includes(option.value));
    return options.length > 2 ? options : [];
  });
  const initialKind = get().layout === 'grid' ? location.url.searchParams.get('rowKind') : null;
  let selectedKind = $state(kindOptions.some(option => option.value === initialKind) ? initialKind! : 'all');
  const kind = $derived(get().kind ?? (selectedKind === 'all' ? undefined : selectedKind));

  const resource = createResource(
    {
      scope: '',
      items: [] as ShelfItem[],
      total: 0,
      page: 1,
      pages: 1,
      title: undefined as string | undefined
    },
    false
  );

  const empty = () => ({
    scope: '',
    items: [] as ShelfItem[],
    total: 0,
    page: 1,
    pages: 1,
    title: undefined as string | undefined
  });

  const generic = $derived(get().mode === 'generic');
  const title = $derived.by(() => {
    const config = get(), loaded = config.title ?? resource.data.title;
    if (loaded !== undefined) return loaded;
    if (config.feature === 'upcoming') return 'Upcoming';
    if (config.feature === 'browse' && config.variant && config.kind) return browseRowTitle(config.kind,config.variant,config.genre);
    if (generic) return config.kind ? catalogueRowTitle(config.kind, config.genre) : 'Discover';
    if (available && config.kind) return browseRowTitle(config.kind,'library',config.genre);
    const medium = category as 'screen' | 'game' | 'music' | 'reading';
    return config.feature === 'row' && config.genre
      ? genreRowTitle(medium, config.genre, config.kind, config.reason, orderSeed)
      : recommendationRowTitle(medium, orderSeed);
  });
  function enabled() {
    const config = { ...page.data, features: page.data.capabilities }, kind = get().kind;
    return (get().feature === 'upcoming'
      ? page.data.capabilities?.planning !== false
      : generic || page.data.capabilities?.personalisation !== false) && categoryEnabled(config, category)
      && ((kind !== 'book' && kind !== 'comic') || categoryEnabled(config, kind))
      && (get().feature !== 'upcoming' || page.data.experiments.planning);
  }

  function updateGridLocation(number: number) {
    if (location.embedded || preview || get().layout !== 'grid') return;
    const url = new URL(location.url.href);
    url.searchParams.set('category', category);
    if (canFilterAvailability()) url.searchParams.set('available', String(available));
    else url.searchParams.delete('available');
    if (selectedKind !== 'all') url.searchParams.set('rowKind', selectedKind);
    else url.searchParams.delete('rowKind');
    url.searchParams.set('page', String(number));
    void location.replace(url);
  }
  const refresh = createShelfRefresh(() => load(), refreshVisible);
  async function load(number?: number, append = false) {
    if (append && resource.busy) return;
    refresh.clear();
    if (!get().category && !categoryEnabled({ ...page.data, features: page.data.capabilities }, category)) category = mediumOptions({ ...page.data, features: page.data.capabilities })[0]?.value ?? category;
    if (!kindOptions.some(option => option.value === selectedKind)) selectedKind = 'all';

    if (!enabled()) {
      resource.replace(empty());

      return;
    }

    number ??= get().layout === 'grid'
      ? Number(location.url.searchParams.get('page') ?? 1)
      : 1;

    if (append) number = resource.data.page + 1;
    const requestedScope = selectionKey;
    if (append && resource.data.scope !== requestedScope) { append = false; number = 1; }

    updateGridLocation(number);

    const params = new URLSearchParams({ category, available: String(!localAvailability && available), page: String(number) });

    if (get().feature === 'upcoming') params.set('view', 'releases');
    if (get().genre) params.set('genre', get().genre!);
    if (get().workId) params.set('work', get().workId!);
    if (kind) params.set('kind', kind);
    if (get().variant) params.set('variant', get().variant!);
    if (!generic && get().reason) params.set('reason', get().reason!);
    if (get().feature !== 'upcoming') params.set('seed', orderSeed);

    const result = await resource.load(
      async (signal) => {
        try {
          const result = await api<typeof resource.data>(`${get().feature === 'upcoming' ? 'planning' : (generic ? 'discover/' : 'experiments/') + get().feature}?${params}`, undefined, 'GET', { signal });
          return {...result, scope: requestedScope};
        } catch(cause) {
          if (!signal.aborted && cause instanceof ApiError && [403, 404].includes(cause.status)) resource.replace(empty(), cause.message);

          throw cause;
        }
      },
      {
        merge: append
          ? (old, next) => ({
            ...next,
            items: uniqueItems([...old.items, ...next.items], (item) => 'workId' in item ? item.workId ?? item.id : item.id)
          })
          : undefined
      }
    );

    if (result && !location.embedded && !preview && get().layout === 'grid') {
      const url = new URL(location.url.href);

      url.searchParams.set('page', String(result.page));
      location.replace(url);
    }

    return result;
  }
 const refreshKey=$derived(contentRevisionKey(page.data,get().feature==='upcoming'?['tracking','planning']:generic?['tracking']:['tracking','social']));
 const scopeKey=$derived(JSON.stringify([
  page.data.user?.id,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities,
  get().feature==='upcoming'&&page.data.experiments.planning,
  get().mode,get().feature,get().variant,get().genre,get().kind,get().reason,get().workId,get().category,get().available,
  ]));
 const selectionKey=$derived(JSON.stringify([scopeKey,category,!localAvailability&&available,selectedKind]));
 let previousScope=untrack(()=>scopeKey);
 let previousRefresh=untrack(()=>refreshKey);
 $effect(()=>{const scope=scopeKey,key=refreshKey;untrack(()=>{
  const changed=scope!==previousScope;
  if(!changed&&key===previousRefresh)return;
  previousScope=scope;previousRefresh=key;
  const activated=resource.activated||resource.ready;
  if(changed){
   if(get().category!==undefined)category=get().category!;
   if(!canFilterAvailability())available=get().available===true;
   if(!kindOptions.some(option=>option.value===selectedKind))selectedKind='all';
   if(activated)resource.replace(empty());
  }
  if(activated)refresh.invalidate();
 });});
  onDestroy(resource.dispose);
 const selectMedium=(value:string)=>{
  if(value===category)return;
  category=value;
  selectedKind='all';
  if(!canFilterAvailability())available=get().available===true;
  void load(1);
 };
  return {
    get title() { return title; },
  get href(){
   if(get().layout==='grid')return undefined;
   const params=new URLSearchParams({section:get().feature==='row'?'dynamic':get().feature,category,view:actionFromCategory(category)});
   if(get().genre)params.set('genre',get().genre!);
   if(get().workId)params.set('work',get().workId!);
   if(get().kind)params.set('kind',get().kind!);
   if(selectedKind!=='all')params.set('rowKind',selectedKind);
   if(get().variant)params.set('variant',get().variant!);
   if(!generic && get().reason)params.set('reason',get().reason!);
   if(get().feature!=='upcoming')params.set('seed',orderSeed);
   if(get().available)params.set('library','true');
   else if(canFilterAvailability())params.set('available',String(available));
      return `${generic?'/discover':'/for-you'}?${params}`;
    },

    get items() {
      if (!enabled() || resource.data.scope !== selectionKey) return [];
      return localAvailability && available ? resource.data.items.filter(item => item.available) : resource.data.items;
    },

    get busy() {
      return resource.busy;
    },

    get ready() {
      return resource.ready;
    },

    get error() {
      return resource.error;
    },

    get activated() {
      return resource.activated;
    },

    get emptyConfirmed() {
      return resource.ready && !resource.data.items.length;
    },

    get resetKey() {
      return `${category}:${kind ?? 'all'}:${available}`;
    },

    get mediaKind() {
      return category === 'all'
        ? 'screen'
        : category as 'screen' | 'game' | 'music' | 'reading';
    },

    get shape() {
      return category === 'reading' || category === 'game'
        ? 'poster' as const
        : category === 'music' ? 'square' as const : 'fanart' as const;
    },

    get artworkStyle() {
      return category === 'reading' || category === 'game' || category === 'music' ? 'primary' as const : 'thumb' as const;
    },

    get pagination() {
      return {
        kind: 'pages' as const,
        page: resource.data.page,
        pages: resource.data.pages,
        append: get().layout !== 'grid',
        controls: (get().layout === 'grid' ? 'both' : 'header') as 'both' | 'header'
      };
    },

    get controls() {
      return [];
    },
    get filterReset() {
      const categoryChoices = mediumOptions({ ...page.data, features: page.data.capabilities }, ['screen', 'game', 'music', 'reading']);
      const defaultCategory = get().category ?? (categoryChoices.some(option => option.value === 'screen') ? 'screen' : categoryChoices[0]?.value ?? category);
      const resetCategory = get().feature === 'row' ? category : defaultCategory;
      return { disabled: category === resetCategory && selectedKind === 'all' && (!canFilterAvailability() || !available),
        run: () => { category = resetCategory; selectedKind = 'all'; if (canFilterAvailability()) available = false; return load(1); } };
    },

    get filters(): ShelfControl[] {
      return [
        ...get().category !== undefined || get().feature === 'row'
          ? []
          : [
            {
              type: 'select' as const,
              label: 'Medium',
              value: category,
              options: mediumOptions({ ...page.data, features: page.data.capabilities }, ['screen', 'game', 'music', 'reading']),
              change: selectMedium
            }
          ],

        ...kindOptions.length ? [{
          type: 'select' as const,
          label: category === 'reading' ? 'Reading type' : 'Media type',
          value: selectedKind,
          options: kindOptions,
          change: (value: string) => {
            if (value === selectedKind || !kindOptions.some(option => option.value === value)) return;
            selectedKind = value;
            void load(1);
          }
        }] : [],

        ...canFilterAvailability()
          ? [
            {
              type: 'availability' as const,
              label: category === 'reading' ? 'Available to read only' : category === 'music' ? 'Available to listen only'
                : category === 'game' ? 'Owned only' : 'Available to watch only',
              value: available ? 'available' : 'all',
              change: (value: string) => {
                const next = value === 'available';
                if (available === next) return;
                available = next;
                if (localAvailability) updateGridLocation(1);
                else void load(1);
              }
            }
          ]
          : []
      ];
    },
    load
  };
}
