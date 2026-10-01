
  import { page as route } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import { api } from '$lib/ui/client';
  import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { creditRoles } from '$lib/media/credits';
  import type { ShelfSource, ShelfControl } from './types';

export type CreditsOptions = {
    layout?: 'row' | 'grid';
    personId: number;
    title: string;
    scope?: 'all' | 'library' | 'known';
  };
export function createCreditsSource(getOptions: () => CreditsOptions): ShelfSource {
  let {
    personId,
    title,
    scope = 'all',
    layout = 'row',
  } = $derived(getOptions());

  type Content = {
    items: (MediaView & { creditRoles?: ReturnType<typeof creditRoles> })[];
    page: number;
    pages: number;
    total: number;
    departments?: string[];
  };
  const resource = createResource<Content>({ items: [], page: 1, pages: 1, total: 0 });
  const result = $derived(resource.data);
  const busy = $derived(resource.busy);
  const ready = $derived(resource.ready);
  const error = $derived(resource.error);
  const rolesById = $derived(new Map(result.items.map((item) => [item.id, item.creditRoles])));
  let type = $state(
      untrack(() => (layout === 'grid' ? (route.url.searchParams.get('type') ?? 'all') : 'all'))
    ),
    department = $state(
      untrack(() =>
        layout === 'grid' ? (route.url.searchParams.get('department') ?? 'all') : 'all'
      )
    ),
    available = $state(
      untrack(
        () =>
          scope === 'library' ||
          (layout === 'grid' && route.url.searchParams.get('available') === 'true')
      )
    );
  const cache = new Map<string, Content>();
  async function load(page = 1) {
    const key = `${personId}:${scope}:${type}:${department}:${available}:${page}`;
    const firstKey = `${personId}:${scope}:${type}:${department}:${available}:1`;
    const path = `people/${personId}/credits?${new URLSearchParams({ scope, type, department, available: String(available), page: String(page) })}`;
    const cached = cache.get(key);
    const response = await resource.load(signal => cached ? Promise.resolve(cached)
      : api<Content>(path, undefined, 'GET', { signal }), {
      merge: (previous, next) => !cached && page > 1 && layout === 'row'
        ? { ...next, items: uniqueItems([...previous.items, ...next.items], item => item.id) }
        : next,
    });
    if (response) {
      cache.set(layout === 'row' ? firstKey : key, response);
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
    }
  }
  $effect(() => {
    personId; scope;
    untrack(() => { cache.clear(); if (resource.activated) void load(); });
  });
  onDestroy(resource.cancel);


  return {
    get title() { return title; }, get items() { return result.items; }, get busy() { return busy; }, get ready() { return ready; },
    get error() { return error; }, get activated() { return resource.activated; },
    get href() { return layout === 'row' ? `/people/${personId}?${new URLSearchParams({section:scope,type,department,available:String(available)})}` : undefined; },
    get page() { return result.page; }, get pages() { return result.pages; }, get headerPagination() { return layout === 'grid'; },
    get rows() { return scope === 'all' ? 2 : 1; }, get hasMore() { return layout==='row' && scope!=='known' && result.page<result.pages; },
    get resetKey() { return `${type}:${department}`; },
    get filters(): ShelfControl[] { return [
      {type:'segments' as const,label:`${title} roles`,value:department,options:[{value:'all',label:'All'},...(result.departments??['Acting','Crew']).map(label=>({value:label,label}))],change:(value:string)=>{department=value;void load();}},
      ...(scope!=='library' ? [{type:'availability' as const,label:'Available to play only',value:available?'available':'all',change:(value:string)=>{available=value==='available';void load();}}] : []),
    ]; },
    get controls(): ShelfControl[] { return [{type:'select',label:`${title} type`,value:type,options:[{value:'all',label:'All'},{value:'movie',label:'Movies'},{value:'show',label:'Shows'}],change:value=>{type=value;void load();}}]; },
    details(item) { const roles=rolesById.get(item.id); return roles && roles.remaining>0 ? {summary:'View all roles',body:roles.full} : undefined; },
    get empty() { return !ready ? 'Loading credits…' : scope==='library' ? 'No available titles in your library.' : 'No credits match these filters.'; }, load,
  };
}
