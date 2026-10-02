
  import { onDestroy, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page as route } from '$app/state';
  import {
    progressTabs,
    progressTitles,
    type ProgressSurface,
    type ProgressContent,
    type ProgressOptions,
  } from '$lib/progress';
  import { useClient } from '$lib/ui/client-context';
  import { createResource } from '$lib/ui/resource.svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { ShelfSource, ShelfControl } from './types';

export type ProgressSourceOptions = {
    initial?: ProgressContent;
    surface?: ProgressSurface;
    username?: string;
    layout?: 'row' | 'grid';
    onitems?: (items: MediaView[], selection: string) => void;
  };
export function createProgressSource(getOptions: () => ProgressSourceOptions): ShelfSource {
  const { api } = useClient();

  let {
    initial,
    surface = 'continue',
    username,
    layout = 'row',
    onitems,
  } = $derived(getOptions());

  const title = $derived(progressTitles[surface]);
  const saved = $derived(surface === 'watchlist' || surface === 'favourites');
  const options = $derived(
    progressTabs.filter(
      (option) =>
        ['watching', 'up-next'].includes(option.value) ||
        (surface === 'profile' && ['finished', 'dropped'].includes(option.value))
    )
  );
  const defaultView = (): ProgressOptions['view'] =>
    surface === 'watchlist' || surface === 'favourites' ? surface : 'watching';
  type Filters = Pick<ProgressOptions, 'kind' | 'scope'>;
  const defaults = (): Filters => ({ kind: 'all', scope: 'all' });
  const emptyContent = (): ProgressContent => ({
    view: defaultView(),
    kind: 'all',
    scope: 'all',
    page: 1,
    pages: 1,
    total: 0,
    items: [],
  });
  let tab = $state<string>(untrack(() => initial?.view ?? defaultView()));
  let preferences = $state<Record<string, Filters>>(
    Object.fromEntries(progressTabs.map((option) => [option.value, defaults()]))
  );
  untrack(() => {
    if (initial) preferences[initial.view] = { kind: initial.kind, scope: initial.scope };
  });
  const current = $derived(preferences[tab]);
  const resource = createResource(untrack(() => initial ?? emptyContent()), !!untrack(() => initial));
  const content = $derived(resource.data);
  const busy = $derived(resource.busy);
  const error = $derived(resource.error);
  const ready = $derived(resource.ready);
  const visible = $derived(layout === 'row' ? content.items.slice(0, 20) : content.items);
  const parameters = (number = 1) =>
    new URLSearchParams({
      ...(username ? { username } : {}),
      view: tab,
      kind: current.kind,
      scope: surface === 'profile' ? 'all' : current.scope,
      page: String(number),
    });
  const href = (number = 1) => '/progress?' + parameters(number);
  $effect(() => {
    const next = initial;
    // Refresh an activated shelf after route data is invalidated by a tracking change.
    route.data;
    untrack(() => {
      if (!next) {
        if (resource.activated) void select(content.page);
        return;
      }
      if (layout === 'grid') {
        tab = next.view;
        preferences[tab] = { kind: next.kind, scope: next.scope };
        resource.replace(next);
      } else if (tab === next.view && current.kind === next.kind && current.scope === next.scope) {
        resource.replace(next);
      } else {
        void select();
      }
    });
  });
  $effect(() => {
    onitems?.(content.items, [content.view, content.kind, content.scope].join(':'));
  });
  async function select(number = 1) {
    const path = `progress?${parameters(number)}`;
    const result = await resource.load(signal => api<ProgressContent>(path, undefined, 'GET', { signal }));
    if (result && layout === 'grid') replaceState(href(result.page), route.state);
  }
  function update(patch: Partial<Filters>) {
    preferences[tab] = { ...current, ...patch };
    void select();
  }
  onDestroy(resource.cancel);


  return {
    get pagination() { return { kind: 'pages' as const, page: content.page, pages: content.pages, append: false, controls: layout === 'grid' ? 'both' as const : 'none' as const }; },
    get title() { return title; }, get items() { return visible; }, get busy() { return busy; },
    get ready() { return ready; }, get error() { return error; }, get activated() { return resource.activated; },
    get href() { return layout === 'row' ? href() : undefined; },
    get shape() { return saved ? 'poster' : 'fanart'; }, get artworkStyle() { return saved ? 'auto' : 'thumb'; },
    get artworkPriority() { return ['watching','up-next'].includes(content.view) ? 'season-show-episode' : undefined; },


    get filters(): ShelfControl[] { return [
      ...(!saved ? [{type:'segments' as const, label:`${title} selection`, value:tab, options, change:(value:string)=>{tab=value;void select();}}] : []),
      ...(surface !== 'profile' ? [{type:'availability' as const,label:'Available to play only',value:current.scope,change:(value:string)=>update({scope:value as Filters['scope']})}] : []),
    ]; },
    get controls(): ShelfControl[] { return [{type:'media-type',label:`${title} media type`,value:current.kind,change:value=>update({kind:value as Filters['kind']})}]; },
    get empty() { return ready ? 'No titles in this selection.' : 'Loading titles…'; },
    retryLabel:'Retry', load:select,
  };
}
