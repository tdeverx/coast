import {actionFromCategory} from '#lib/actions.js';
import { useShelfLocation } from '#lib/ui/detail-section.svelte.js';
import type { BrowseVariant, GenreReason, DynamicKind } from '#lib/recommendations/model.js';
import { browseRowTitle, catalogueRowTitle, genreRowTitle, recommendationRowTitle } from '#lib/recommendations/row-titles.js';
import { categoryEnabled, mediumOptions } from '#lib/experimental.js';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { onDestroy, untrack } from 'svelte';
import { useClient } from '#lib/ui/client-context.js';
import { createResource, uniqueItems } from '#lib/ui/resource.svelte.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
import { ApiError } from '#lib/ui/client.js';
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

  let available = $state(get().available === true || get().feature !== 'upcoming' && get().feature !== 'browse' && get().layout === 'grid'
    && (get().mode !== 'generic' || !!page.data.user) && location.url.searchParams.get('available') === 'true');

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
    return (get().feature === 'upcoming'
      ? page.data.capabilities?.planning !== false
      : generic || page.data.capabilities?.personalisation !== false) && categoryEnabled({ ...page.data, features: page.data.capabilities }, category) && (get().kind !== 'book' || page.data.experimentalBooks) && (get().kind !== 'comic' || page.data.experimentalComics) && (get().feature !== 'upcoming' || page.data.experiments.planning);
  }

  const refresh = createShelfRefresh(() => load(), refreshVisible);
  async function load(number?: number, append = false) {
    if (append && resource.busy) return;
    refresh.clear();
    if (!get().category && !categoryEnabled({ ...page.data, features: page.data.capabilities }, category)) category = mediumOptions({ ...page.data, features: page.data.capabilities })[0]?.value ?? category;

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

    if (!location.embedded && !preview && get().layout === 'grid') {
      const url = new URL(location.url.href);

      url.searchParams.set('category', category);

      if (get().feature === 'upcoming' || get().feature === 'browse') url.searchParams.delete('available'); else url.searchParams.set('available', String(available));

      url.searchParams.set('page', String(number));
      goto(url, { shallow: true, replace: true, reset: false, state: page.state });
    }

    const params = new URLSearchParams({ category, available: String(available), page: String(number) });

    if (get().feature === 'upcoming') params.set('view', 'releases');
    if (get().genre) params.set('genre', get().genre!);
    if (get().workId) params.set('work', get().workId!);
    if (get().kind) params.set('kind', get().kind!);
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
      goto(url, { shallow: true, replace: true, reset: false, state: page.state });
    }

    return result;
  }
 const refreshKey=$derived(contentRevisionKey(page.data,get().feature==='upcoming'?['tracking','planning']:generic?['tracking']:['tracking','social']));
 const scopeKey=$derived(JSON.stringify([
  page.data.user?.id,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities,
  get().feature==='upcoming'&&page.data.experiments.planning,
  get().mode,get().feature,get().variant,get().genre,get().kind,get().reason,get().workId,get().category,
  ]));
 const selectionKey=$derived(JSON.stringify([scopeKey,category,available]));
 let previousScope=untrack(()=>scopeKey);
 let previousRefresh=untrack(()=>refreshKey);
 $effect(()=>{const scope=scopeKey,key=refreshKey;untrack(()=>{
  const changed=scope!==previousScope;
  if(!changed&&key===previousRefresh)return;
  previousScope=scope;previousRefresh=key;
  const activated=resource.activated||resource.ready;
  if(changed){if(get().category!==undefined)category=get().category!;if(activated)resource.replace(empty());}
  if(activated)refresh.invalidate();
 });});
  onDestroy(resource.dispose);
 const selectMedium=(value:string)=>{category=value;void load(1);};
  return {
    get title() { return title; },
  get href(){
   if(get().layout==='grid')return undefined;
   const params=new URLSearchParams({section:get().feature==='row'?'dynamic':get().feature,category,view:actionFromCategory(category)});
   if(get().genre)params.set('genre',get().genre!);
   if(get().workId)params.set('work',get().workId!);
   if(get().kind)params.set('kind',get().kind!);
   if(get().variant)params.set('variant',get().variant!);
   if(!generic && get().reason)params.set('reason',get().reason!);
   if(get().feature!=='upcoming')params.set('seed',orderSeed);
   if(get().feature!=='upcoming'&&get().feature!=='browse')params.set('available',String(available));
      return `${generic?'/discover':'/for-you'}?${params}`;
    },

    get items() {
      return enabled() && resource.data.scope === selectionKey ? resource.data.items : [];
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
      return `${category}:${get().kind ?? 'all'}:${available}`;
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

    get filters(): ShelfControl[] {
      return [
        ...get().category !== undefined || get().feature === 'row'
          ? []
          : [
            {
              type: 'segments' as const,
              label: `${get().feature} medium`,
              value: category,
              options: mediumOptions({ ...page.data, features: page.data.capabilities }, ['screen', 'game', 'music', 'reading']),
              change: selectMedium
            }
          ],

        ...get().feature !== 'upcoming' && get().feature !== 'browse' && !get().available && (!generic || !!page.data.user)
          ? [
            {
              type: 'availability' as const,
              label: 'Available',
              value: available ? 'available' : 'all',
              change: (value: string) => {
                available = value === 'available';
                void load(1);
              }
            }
          ]
          : []
      ];
    },
    load
  };
}
