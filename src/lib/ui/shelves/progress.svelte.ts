import {useShelfLocation} from '#lib/ui/detail-section.svelte.js';
import { mediumOptions, categoryEnabled } from '#lib/experimental.js';

import { onDestroy, untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page as route } from '$app/state';
import {
  progressTabs,
  progressSelectionTabs,
  progressTitles,
  type ProgressSurface,
  type ProgressContent,
    type ProgressOptions,
} from '#lib/progress.js';
import { useClient } from '#lib/ui/client-context.js';
import { ApiError } from '#lib/ui/client.js';
  import { createResource,uniqueItems } from '#lib/ui/resource.svelte.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
import type { MediaView, MediaCardPresentation } from '#lib/ui/types.js';
import type { ShelfSource, ShelfControl } from './types';
import { readingTypeOptions } from '#lib/ui/filter-options.js';
import { progressCardStyle } from '#lib/ui/progress-card-style.js';

export type ProgressSourceOptions = {
  category?:ProgressOptions['category'];
  actionScoped?:boolean;
  initial?: ProgressContent;
    filters?:ProgressOptions;
  mediums?: boolean;
  surface?: ProgressSurface;
  username?: string;
  layout?: 'row' | 'grid';
    onitems?: (items: (MediaView | MediaCardPresentation)[], selection: string) => void;
 };
export function createProgressSource(getOptions: () => ProgressSourceOptions): ShelfSource {
 const location=useShelfLocation();
  const { api, preview } = useClient();

  let {
    initial,
    surface = 'continue',
    username,
    layout = 'row',
    onitems,
    mediums = false,
  } = $derived(getOptions());

  const initialFilters=untrack(()=>getOptions().filters??initial);
  const saved = $derived(surface === 'recommendations' || surface === 'next' || surface === 'watchlist' || surface === 'favourites');
  const selectionSurface = $derived(!saved&&!mediums&&!getOptions().actionScoped ? surface==='profile'?'profile':'continue' : undefined);
  const defaultView = (): ProgressOptions['view'] => surface === 'recommendations' || surface === 'next' || surface === 'watchlist' || surface === 'favourites' ? surface : 'watching';

  type Filters = Pick<ProgressOptions, 'kind' | 'scope'>;
  const defaults = (): Filters => ({ kind: 'all', scope: 'all' });
  const emptyContent = (): ProgressContent => ({
    view: defaultView(),
    kind: 'all',
    category: 'screen',
    scope: 'all',
    page: 1,
    pages: 1,
    total: 0,
    items: [],
  });
  let category = $state<ProgressOptions['category']>(untrack(() => getOptions().category??initialFilters?.category ?? 'screen'));
  const title = $derived(surface==='watchlist'?'Later':category==='reading'&&surface==='continue'?'Continue reading':category==='game'&&surface==='continue'?'Playing':progressTitles[surface]);
  let tab = $state<string>(untrack(() => initialFilters?.view ?? defaultView()));
  const style = $derived(category === 'music' ? undefined : progressCardStyle(tab));
  let preferences = $state<Record<string, Filters>>(
    Object.fromEntries([...progressTabs, {value:'next',label:'Next'}, {value:'recommendations',label:'Recommendations'}].map((option) => [option.value, defaults()]))
  );
  untrack(() => {
    if (initialFilters) preferences[initialFilters.view] = { kind: initialFilters.kind, scope: initialFilters.scope };
  });
  const current = $derived(preferences[tab]);
  const resource = createResource(untrack(() => initial ?? emptyContent()), !!untrack(() => initial));
  const content = $derived(resource.data);
  const busy = $derived(resource.busy);
  const error = $derived(resource.error);
  const ready = $derived(resource.ready);
  const visible = $derived(content.items);

  const parameters = (number = 1) => new URLSearchParams({
    ...username ? { username } : {},
    ...getOptions().actionScoped ? { scoped: 'true' } : {},
    view: tab,
    category,
    kind: category === 'screen' || category === 'reading' ? current.kind : 'all',
    scope: surface === 'profile' ? 'all' : current.scope,
      page: String(number),
  });
  const href = (number = 1) => '/progress?' + parameters(number);
  const ownerKey = $derived(JSON.stringify([route.data.user?.id,username,getOptions().category,route.data.capabilities,route.data.experimentalMusic,route.data.experimentalGaming,route.data.experimentalBooks,route.data.experimentalComics]));
  let loadedOwner = $state(untrack(() => ownerKey));
  const views=$derived(loadedOwner===ownerKey?content.availableViews:undefined);
  const options=$derived((selectionSurface?progressSelectionTabs(selectionSurface):[]).map(option=>({
    ...option,disabled:views!==undefined&&!views.includes(option.value),
  })));
  const refreshKey = $derived(JSON.stringify([contentRevisionKey(route.data, ['tracking', 'social']), username, surface, route.data.experimentalMusic, route.data.experimentalGaming, route.data.experimentalBooks, route.data.experimentalComics,route.data.capabilities]));
  const summaryEpoch=$derived(JSON.stringify([ownerKey,refreshKey,category,selectionSurface]));
  let confirmedEpoch=untrack(()=>initial?.availableViews?summaryEpoch:undefined);
  let previousRefreshKey = untrack(() => refreshKey);
  let previousInitial = untrack(() => initial);
  $effect(() => {
    const next = initial;
    const key = refreshKey;
    const owner = ownerKey;
    untrack(() => {
      const revisionChanged = key !== previousRefreshKey;
      const initialChanged = next !== previousInitial;
      previousRefreshKey = key;
      previousInitial = next;
      if (owner !== loadedOwner) {
        const activated = resource.activated || resource.ready;
        if (getOptions().category) category = getOptions().category!;
        if (activated) resource.replace(emptyContent());
        loadedOwner = owner;
        if (next && initialChanged) {
          tab = next.view; category = next.category;
          preferences[tab] = {kind:next.kind,scope:next.scope};
          resource.replace(next);
          confirmedEpoch=next.availableViews?summaryEpoch:undefined;
        } else if (activated) void select();
        return;
      }
      if (!next) {
        if ((revisionChanged || initialChanged) && resource.activated) void select(layout==='row'?1:content.page);
        return;
      }
      // A session poll can report provider changes without re-running the page's initial load.
      if (revisionChanged && !initialChanged) {
        void select(layout==='row'?1:content.page);
        return;
      }
      if (layout === 'grid') {
        tab = next.view;
        category = next.category;
        preferences[tab] = { kind: next.kind, scope: next.scope };
        resource.replace(next);
        confirmedEpoch=next.availableViews?summaryEpoch:undefined;
      } else if (category === next.category && tab === next.view && current.kind === next.kind && current.scope === next.scope) {
        resource.replace(next);
        confirmedEpoch=next.availableViews?summaryEpoch:undefined;
      } else {
        void select();
      }
    });
  });
  $effect(()=>{
    const settled=initial;
    if(layout==='grid'&&!location.embedded&&!preview&&settled?.availableViews){
      untrack(()=>{
        if(settled.view!==(route.url.searchParams.get('view')??'watching'))
          void goto(href(settled.page),{shallow:true,replace:true,reset:false,state:route.state});
      });
    }
  });
  $effect(() => {
    onitems?.(content.items, [content.view, content.category, content.kind, content.scope].join(':'));
  });
  async function select(number = 1,append=false) {
    const features={...route.data,features:route.data.capabilities};
    if(!categoryEnabled(features,category)){
      const next=mediumOptions(features)[0]?.value;
      if(!next){resource.replace(emptyContent());return;}
      if(getOptions().actionScoped){resource.replace(emptyContent());return;}
      category=next as ProgressOptions['category'];
    }
    if(surface==='recommendations'&&route.data.capabilities?.social===false){resource.replace(emptyContent());return;}
    const request=parameters(number);
    const epoch=summaryEpoch;
    const includeSummary=selectionSurface&&category==='screen'&&confirmedEpoch!==epoch;
    if(includeSummary)request.set('segments',selectionSurface!);
    const path = `progress?${request}`;
    const owner = username;
    const requestedOwner=ownerKey;

    const result = await resource.load(
      async (signal) => {
        try {
          const next=await api<ProgressContent>(path, undefined, 'GET', { signal });
          if(!signal.aborted&&ownerKey===requestedOwner){
            if(next.availableViews){
              confirmedEpoch=epoch;
              if(next.view!==tab){tab=next.view;preferences[tab]={kind:next.kind,scope:next.scope};}
            }
          }
          return next;
      } catch (cause) {
          if (owner && owner === username && !signal.aborted && cause instanceof ApiError && [403, 404].includes(cause.status)){
            confirmedEpoch=undefined;
            resource.replace({ ...resource.data, availableViews:undefined, items: [], total: 0, page: 1, pages: 1 }, cause.message);
          }
          throw cause;
        }
      },
      {
        merge: (old, next) => ({
          ...next,
          availableViews:next.availableViews??(includeSummary?undefined:old.availableViews),
          items: append&&old.view===next.view
            ? uniqueItems([...old.items, ...next.items], (item) => item.entryId ?? item.id)
            : next.items
        })
      }
    );

    if (result && !location.embedded && !preview && layout === 'grid') goto(href(result.page), { shallow: true, replace: true, reset: false, state: route.state });
  }

  function update(patch: Partial<Filters>) {
    if (Object.entries(patch).every(([key,value])=>current[key as keyof Filters]===value)) return;
    preferences[tab] = { ...current, ...patch };
    void select();
  }
  onDestroy(resource.dispose);


  return {
    get filterReset() { return { disabled: current.kind === 'all' && current.scope === 'all', run: () => update(defaults()) }; },
    get pagination() {
      return {
        kind: 'pages' as const,
        page: content.page,
        pages: content.pages,
        append: false,
        controls: layout === 'grid' ? 'both' as const : 'none' as const
      };
    },

    get title() {
      return title;
    },

    get items() {
      return loadedOwner === ownerKey && content.category === category && content.view === tab && content.kind === (category==='screen'||category==='reading'?current.kind:'all') && content.scope === (surface==='profile'?'all':current.scope) ? visible : [];
    },

    get busy() {
      return busy;
    },

    get emptyConfirmed() {
      return !mediums || content.emptyAllMedia === true;
    },
    get hideRow() {
      return !!selectionSurface&&views?.length===0;
    },

    get ready() {
      return ready;
    },

    get error() {
      return error;
    },

    get activated() {
      return resource.activated;
    },

    get href() {
      return layout === 'row' ? href() : undefined;
    },

    get shape() {
      return category === 'music'
        ? 'square'
        : style?.shape ?? (saved || category === 'reading' ? 'poster' : 'fanart');
    },

    get mediaKind() {
      return category;
    },

    get artworkStyle() {
      return style?.artworkStyle ?? (category !== 'screen' || saved ? 'auto' : 'thumb');
    },

    get artworkPriority() {
      return style?.artworkPriority;
    },

    get filters(): ShelfControl[] {
      return [
        ...mediums
          ? [
            {
              type: 'segments' as const,
              label: `${title} medium`,
              value: category,
              options: mediumOptions({ ...route.data, features: route.data.capabilities }),
              change: (value: string) => {
                category = value as ProgressOptions['category'];
                preferences[tab] = defaults();
                void select();
              }
            }
          ]
          : [],

        ...options.length
          ? [
            {
              type: 'segments' as const,
              label: `${title} selection`,
              value: tab,
              options,
              change: (value: string) => {
                if(value===tab||!options.some(option=>option.value===value&&!option.disabled))return;
                tab = value;
                void select();
              }
            }
          ]
          : [],

        ...surface !== 'profile'
          ? [
            {
              type: 'availability' as const,
              label: category === 'reading' ? 'Available to read only' : category === 'game' ? 'Available to play only' : 'Available to watch only',
              value: current.scope,
              change: (value: string) => update({ scope: value as Filters['scope'] })
            }
          ]
          : []
      ];
    },

    get controls(): ShelfControl[] {
      return category === 'screen'
        ? [
          {
            type: 'media-type',
            label: 'Media type',
            value: current.kind,
            change: (value) => update({ kind: value as Filters['kind'] })
          }
        ]
        : category === 'reading'
          ? [
            {
              type: 'select',
              label: 'Reading type',
              value: current.kind,
              options: readingTypeOptions({ ...route.data, features: route.data.capabilities }),
              change: (value) => update({ kind: value as Filters['kind'] })
            }
          ]
          : [];
    },

    get empty() {
      return busy
        ? 'Loading titles…'
        : ready ? 'No titles in this selection.' : 'Loading titles…';
    },
    retryLabel: 'Retry',
    load: select
  };
}
