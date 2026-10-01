
  import { onDestroy, untrack } from 'svelte';
  import { page as route } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { PresentationRow } from '$lib/server/queries/media-rows';
  import { api } from '$lib/ui/client';
  import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
  import {
    libraryPath,
    libraryTitles,
    librarySelections,
    type LibraryContent,
    type LibrarySurface,
  } from '$lib/library';
  import type { ShelfSource, ShelfControl } from './types';

export type LibrarySourceOptions = {
    surface: LibrarySurface;
    preview?: { title: string; personal?: boolean; empty: string; refreshKey?: unknown };
    initial?: LibraryContent;
    genre?: string;
    layout?: 'row' | 'grid';
    initialSelection?: string;
    initialKind?: 'all' | 'movie' | 'show';
    initialScope?: 'all' | 'available';
    collection?: boolean;
    username?: string;
    initialRelationship?: string;
    initialSource?: string;
    initialAvailability?: string;
  };
export function createLibrarySource(getOptions: () => LibrarySourceOptions): ShelfSource {
  let {
    surface,
    initial,
    genre = '',
    layout = 'row',
    initialSelection = 'all',
    initialKind = 'all',
    initialScope = 'available',
    collection = false,
    username = '',
    initialRelationship = 'all',
    initialSource = 'all',
    initialAvailability = 'all',
    preview,
  } = $derived(getOptions());

  const title = $derived(preview?.title ?? libraryTitles[surface]);
  let selection = $state(untrack(() => initialSelection)),
    kind = $state(untrack(() => initialKind)),
    scope = $state(untrack(() => initialScope));
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
  const parameters = (number = 1) => collection
    ? new URLSearchParams({category:surface==='watch'?'screen':surface==='listen'?'music':'game',level:'root',
      activity:surface==='listen'?'all':selection==='progress'||selection==='in-progress'?'active':selection==='watched'?'completed':selection,
      kind:surface==='listen'?selection:surface==='play'?'all':kind,relationship,source,availability,...(username?{username}:{}),page:String(number)})
    : new URLSearchParams({ surface, selection, kind, scope, genre, page: String(number) });
  function href(number = 1) {
    if (preview) return surface === 'listen' ? `/music?kind=${selection}` : `/games${preview.personal ? '?personal=true' : ''}`;
    if (collection) {const params=parameters(number);params.set('view',surface);return `/collection?${params}`;}
    if (surface === 'watch')
      return (
        '/library?' +
        new URLSearchParams({
          view: 'watch',
          tracking: selection,
          kind,
          scope,
          genre,
          page: String(number),
        })
      );
    if (surface === 'listen')
      return '/music?' + new URLSearchParams({ kind: selection, page: String(number) });
    return '/games?' + new URLSearchParams({ state: selection, page: String(number) });
  }
  async function load(number = 1, append = false) {
    const path = collection ? `collection?${parameters(number)}`
      : libraryPath(preview ? { preview: true, surface, selection, personal: preview.personal ?? false } : { surface, selection, kind, scope, genre, page: number });
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
    get title() { return title; }, get items() { return content.items; }, get busy() { return busy; }, get ready() { return ready; },
    get error() { return failure; }, get activated() { return resource.activated; },
    get href() { return layout === 'row' ? href() : undefined; },
    get shape() { return surface==='listen' ? 'square' : 'poster'; }, get mediaKind() { return surface==='listen' ? 'music' : surface==='play' ? 'game' : 'screen'; },
    get rows() { return preview ? 1 : 2; }, get page() { return content.page; }, get pages() { return content.pages; },
    get footerPagination() { return layout==='grid'; }, get hasMore() { return content.page<content.pages; },
    get resetKey() { return preview ? selection : `${selection}:${kind}:${scope}:${relationship}:${source}:${availability}`; },
    get filters(): ShelfControl[] { return preview ? [] : [
      {type:'segments' as const,label:`${title} selection`,value:selection,options:selections,change:(value:string)=>{selection=value;void load();}},
      ...(surface==='watch' ? [{type:'availability' as const,label:'Available to play only',value:scope,change:(value:string)=>{scope=value as typeof scope;if(collection) availability=value==='available'?'available':'all';void load();}}] : []),
    ]; },
    get controls(): ShelfControl[] {
      if(preview) return surface==='listen' ? [{type:'select',label:`${title} type`,value:selection,options:librarySelections.listen,change:value=>{selection=value;void load();}}] : [];
      return [
        ...(surface==='watch' ? [{type:'media-type' as const,label:'Watch type',value:kind,change:(value:string)=>{kind=value as typeof kind;void load();}}]
          : collection ? [{type:'availability' as const,label:'Available to play only',value:availability,change:(value:string)=>{availability=value;void load();}}] : []),
        ...(collection ? [
          {type:'select' as const,label:`${title} relationships`,value:relationship,options:[{value:'all',label:'All relationships'},{value:'collected',label:'Collected'},{value:'watchlist',label:'Watchlist'},{value:'favourite',label:'Favourites'},{value:'rating',label:'Rated'},{value:'list',label:'Lists'},{value:'queue',label:'Queued'},{value:'activity',label:'Activity'}],change:(value:string)=>{relationship=value;void load();}},
          {type:'select' as const,label:`${title} availability`,value:availability,options:[{value:'all',label:'All availability'},{value:'available',label:'Available'},{value:'partial',label:'Partial'},{value:'unavailable',label:'Missing'},{value:'unknown',label:'Unknown'},{value:'ready',label:'Ready to continue'}],change:(value:string)=>{availability=value;scope=value==='available'?'available':'all';void load();}},
          ...(content.sources?.length ? [{type:'select' as const,label:`${title} sources`,value:source,options:[{value:'all',label:'All sources'},...content.sources.map(item=>({value:item.id,label:item.name}))],change:(value:string)=>{source=value;void load();}}] : []),
        ] : []),
      ];
    },
    get empty() { return preview ? busy || !ready ? `Loading ${title.toLowerCase()}…` : preview.empty : ready ? 'No titles in this selection.' : 'Loading titles…'; },
    get emptyHref() { return preview && ready && !busy ? href() : undefined; },
    get emptyLink() { return `Browse ${surface==='listen'?'music':'games'}`; }, load,
  };
}
