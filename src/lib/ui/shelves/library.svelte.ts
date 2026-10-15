
  import { onDestroy, untrack } from 'svelte';
  import { page as route } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { PresentationRow } from '$lib/server/queries/media-rows';
  import { useClient } from '$lib/ui/client-context';
  import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
  import {
    libraryBrowsePaths,
    libraryTitles,
    librarySelections,
    type LibraryContent,
    type LibrarySurface,
  } from '$lib/library';
  import type { ShelfSource, ShelfControl } from './types';
  import { readingTypeOptions } from '$lib/ui/filter-options';

export type LibrarySourceOptions = {
    surface: LibrarySurface;
    preview?: { title: string; personal?: boolean; empty: string; refreshKey?: unknown };
    initial?: LibraryContent;
    genre?: string;
    layout?: 'row' | 'grid';
    initialSelection?: string;
    initialKind?: 'all' | 'movie' | 'show' | 'book' | 'comic';
    initialScope?: 'all' | 'available';
    collection?: boolean;
    username?: string;
    initialRelationship?: string;
    initialSource?: string;
    initialAvailability?: string;
  };
export function createLibrarySource(getOptions: () => LibrarySourceOptions): ShelfSource {
  const { api } = useClient();

  let {
    surface,
    initial,
    genre = '',
    layout = 'row',
    initialSelection = 'all',
    initialKind = 'all',
    initialScope = getOptions().preview || getOptions().surface === 'read' ? 'all' : 'available',
    collection: initialCollection = false,
    username = '',
    initialRelationship = 'all',
    initialSource = 'all',
    initialAvailability = 'all',
    preview,
  } = $derived(getOptions());

  let collection = $state(untrack(() => initialCollection));
  const title = $derived(preview?.title ?? libraryTitles[surface]);
  let selection = $state(untrack(() => initialSelection)),
    kind = $state(untrack(() => initialKind)),
    scope = $state<'all' | 'available'>(untrack(() => collection ? initialAvailability === 'available' ? 'available' : 'all' : initialScope));
  let relationship = $state(untrack(() => initialRelationship)),
    source = $state(untrack(() => initialSource)),
    availability = $state(untrack(() => initialAvailability));
  type Content = LibraryContent & { sources?: { id: string; name: string }[] };
  const resource = createResource<Content>(
    untrack(() => initial ?? { items: [], page: 1, pages: 1, total: 0 }), !!untrack(() => initial)
  );
  const content = $derived(resource.data);
  const busy = $derived(resource.busy);
  const failure = $derived(resource.error);
  const ready = $derived(resource.ready);
  const selections = $derived(collection && surface === 'listen' ? librarySelections.listen.filter(option => option.value !== 'artist') : librarySelections[surface]);
  const paths = (number = 1) => libraryBrowsePaths({ surface, collection, selection, kind, scope, genre, relationship, source, availability, username, page: number }, preview);
  const href = (number = 1) => paths(number).href;
  async function load(number = 1, append = false) {
    const path = paths(number).api;
    if (!append) resource.replace({ items: [], page: 1, pages: 1, total: 0 });
    const result = await resource.load(async signal => {
      if (!preview) return api<Content>(path, undefined, 'GET', { signal });
      const result = await api<PresentationRow>(path, undefined, 'GET', { signal });
      return { ...result, page: 1, pages: 1, total: result.items.length };
    }, {
      failure: result => result.failure ?? '',
      usable: result => !result.failure || result.items.length > 0,
      merge: (previous, result) => ({ ...result, items: uniqueItems(
        append ? [...previous.items, ...result.items] : result.items,
        item => item.entryId ?? ('href' in item ? item.href : item.id)
      ) }),
    });
    if (result && !preview && layout === 'grid') replaceState(href(result.page), route.state);
  }
  $effect(() => {
    route.data.filters;
    preview?.refreshKey;
    const next = initial;
    untrack(() => {
      if (next && layout === 'grid') resource.replace(next);
      else if (resource.activated) void load();
    });
  });
  onDestroy(resource.cancel);


  return {
    get pagination() { return { kind: 'pages' as const, page: content.page, pages: content.pages, append: true, controls: layout === 'grid' ? 'footer' as const : 'none' as const }; },
    get title() { return title; }, get items() { return content.items; }, get busy() { return busy; }, get ready() { return ready; },
    get error() { return failure; }, get activated() { return resource.activated; },
    get href() { return layout === 'row' ? href() : undefined; },
    get shape() { return surface==='listen' ? 'square' : 'poster'; }, get mediaKind() { return surface==='listen' ? 'music' : surface==='play' ? 'game' : surface==='read' ? 'reading' : 'screen'; },
    get rows() { return preview ? 1 : 2; },

    get resetKey() { return preview ? `${selection}:${scope}` : `${collection}:${selection}:${kind}:${scope}:${relationship}:${source}:${availability}`; },
    get filters(): ShelfControl[] { return [
      {type:'segments' as const,label:`${title} selection`,value:selection,options:selections,change:(value:string)=>{selection=value;void load();}},
      ...(!preview ? [{type:'collection' as const,label:'In my Collection only',value:collection ? 'collection' : 'all',change:(value:string)=>{collection=value==='collection';if(collection && selection==='artist') selection='all';if(collection) availability=scope==='available'?'available':availability==='available'?'all':availability;void load();}}] : []),
      ...[{type:'availability' as const,label:surface==='read'?'Available to read only':'Available to play only',value:scope,change:(value:string)=>{scope=value as typeof scope;if(collection) availability=value==='available'?'available':'all';void load();}}],
    ]; },
    get controls(): ShelfControl[] {
      return [
        ...(surface==='watch' ? [{type:'media-type' as const,label:'Watch type',value:kind,change:(value:string)=>{kind=value as typeof kind;void load();}}] : []),
        ...(surface==='read' ? [{type:'select' as const,label:'Reading type',value:kind,options:readingTypeOptions(route.data),change:(value:string)=>{kind=value as typeof kind;void load();}}] : []),
        ...(collection ? [
          {type:'select' as const,label:`${title} relationships`,value:relationship,options:[{value:'all',label:'All relationships'},{value:'collected',label:'Collected'},{value:'watchlist',label:'Watchlist'},{value:'favourite',label:'Favourites'},{value:'rating',label:'Rated'},{value:'list',label:'Lists'},...(surface!=='read'?[{value:'queue',label:'Queued'}]:[]),{value:'activity',label:'Activity'}],change:(value:string)=>{relationship=value;void load();}},
          {type:'select' as const,label:`${title} availability`,value:availability,options:[{value:'all',label:'All availability'},{value:'available',label:'Available'},...(surface!=='read'?[{value:'partial',label:'Partial'},{value:'unavailable',label:'Missing'}]:[]),{value:'unknown',label:'Unknown'},{value:'ready',label:'Ready to continue'}],change:(value:string)=>{availability=value;scope=value==='available'?'available':'all';void load();}},
          ...(content.sources?.length ? [{type:'select' as const,label:`${title} sources`,value:source,options:[{value:'all',label:'All sources'},...content.sources.map(item=>({value:item.id,label:item.name}))],change:(value:string)=>{source=value;void load();}}] : []),
        ] : []),
      ];
    },
    get empty() { return surface === 'play' && scope === 'available' ? 'No owned games match this selection. Turn off Available to browse all games.' : preview ? busy || !ready ? `Loading ${title.toLowerCase()}…` : preview.empty : ready ? 'No titles in this selection.' : 'Loading titles…'; },
    get emptyHref() { return preview && ready && !busy ? href() : undefined; },
    get emptyLink() { return `Browse ${surface==='listen'?'music':'games'}`; }, load,
  };
}
