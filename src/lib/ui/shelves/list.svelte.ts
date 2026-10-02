
  import { onDestroy, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { MediaView, MediaCardPresentation } from '$lib/ui/types';
  import { message } from '$lib/ui/client';
import { useClient } from '$lib/ui/client-context';
  import { createResource } from '$lib/ui/resource.svelte';
  type Content = {
    selected?: { playlist: boolean } | null;
    items: (MediaView|MediaCardPresentation)[];
    page: number;
    pages: number;
    total: number;
    kind: 'all' | 'movie' | 'show' | 'album' | 'track' | 'game';
    filter: string;
    scope?: 'all' | 'available';
  };
  import type { ShelfSource, ShelfControl, ShelfAction } from './types';

export type ListSourceOptions = {
    view: string;
    title: string;
    custom?: boolean;
    layout?: 'row' | 'grid';
    initial?: Content;
    onitems?: (items: MediaView[], selection: string) => void;
    ondelete?: () => void;
  };
export function createListSource(getOptions: () => ListSourceOptions): ShelfSource {
  const { api, change } = useClient();

  let {
    view,
    title,
    custom = false,
    layout = 'row',
    initial,
    onitems,
    ondelete,
  } = $derived(getOptions());

  const resource = createResource<Content>(
    untrack(() => initial ?? { items: [], page: 1, pages: 1, total: 0, kind: 'all', filter: 'all' }), !!untrack(() => initial)
  );
  const content = $derived(resource.data);
  const busy = $derived(resource.busy);
  const error = $derived(resource.error);
  const ready = $derived(resource.ready);
  let scope = $state(untrack(() => content.scope ?? 'all'));
  let kind = $state(untrack(() => content.kind));
  const filter = 'all';
  let arranging = $state(false);
  const selection = $derived(`${view}:${content.kind}:${content.filter}`);
  const href = (number = 1) =>
    `/lists?${new URLSearchParams({ view, kind, filter, scope, page: String(number) })}`;
  $effect(() => {
    if (ready) onitems?.(content.items.filter((item):item is MediaView=>!('href' in item)), selection);
  });
  async function load(number = 1) {
    const path = `lists/content?${new URLSearchParams({ view, kind, filter, scope, page: String(number) })}`;
    const result = await resource.load(signal => api<Content>(path, undefined, 'GET', { signal }));
    if (result && layout === 'grid') replaceState(href(result.page), page.state);
  }
  async function edit(id: string, direction?: number) {
    try {
      if (direction) await change(`lists/${view}/move`, { entryId: id, direction });
      else await change(`lists/${view}/items`, { entryId: id }, 'DELETE');
      await load(content.page);
    } catch (cause) {
      resource.error = message(cause);
    }
  }
  onDestroy(resource.cancel);


  return {
    get pagination() { return { kind: 'pages' as const, page: content.page, pages: content.pages, append: false, controls: layout === 'grid' ? 'both' as const : 'none' as const, url: href }; },
    get title() { return title; }, get items() { return layout === 'row' ? content.items.slice(0,20) : content.items; },
    get busy() { return busy; }, get ready() { return ready; }, get error() { return error; }, get activated() { return resource.activated; },
    get href() { return layout === 'row' ? href() : undefined; },

    get filters(): ShelfControl[] { return [{type:'availability',label:'Available to play only',value:scope,change:value=>{scope=value as typeof scope;void load();}}]; },
    get controls(): ShelfControl[] { return [{type:'media-type',includeOtherMedia:!!page.data.experimentalFeatures,label:`${title} media type`,value:kind,change:value=>{kind=value as Content['kind'];void load();}}]; },
    get sequence() { return content.selected?.playlist ? {kind:'playlist' as const,id:view} : undefined; },
    get actions(): ShelfAction[] { return custom && layout === 'grid' ? [
      {label:arranging?'Done':'Arrange',run:()=>{arranging=!arranging;}},
      {label:'Delete list',run:()=>ondelete?.()},
    ] : []; },
    details(item) { return custom && arranging ? {actions:[
      {label:`Move ${item.title} earlier`,icon:'left',disabled:busy || (content.page===1 && content.items[0]?.entryId===item.entryId),run:()=>edit(item.entryId!,-1)},
      {label:`Move ${item.title} later`,icon:'right',disabled:busy || (content.page===content.pages && content.items.at(-1)?.entryId===item.entryId),run:()=>edit(item.entryId!,1)},
      {label:`Remove ${item.title} from list`,icon:'close',disabled:busy,run:()=>edit(item.entryId!)},
    ]} : undefined; },
    get empty() { return ready ? 'No titles in this selection.' : 'Loading titles…'; }, retryLabel:'Retry', load,
  };
}
