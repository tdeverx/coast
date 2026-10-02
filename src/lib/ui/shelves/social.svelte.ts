import { onDestroy, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import type { ShelfSource, ShelfItem } from './types';
type Feed = { items: ShelfItem[]; hasMore: boolean; next: { before: string; beforeId: string } | null };
export type SocialShelfOptions = { type: 'social'; layout?: 'row' | 'grid'; initial?: Feed; category?: string };
export function createSocialSource(get: () => SocialShelfOptions): ShelfSource {
  const { api } = useClient();

 const initial = untrack(() => get().initial);
 const resource = createResource<Feed>(initial ?? { items: [], hasMore: false, next: null }, !!initial);
 async function load(_page = 1, append = false) {
  if (append && resource.busy) return;
  const query = new URLSearchParams({ category: get().category ?? 'all', ...(append && resource.data.next ? resource.data.next : {}) });
  await resource.load(signal => api<Feed>(`social/feed?${query}`, undefined, 'GET', { signal }), {
   merge: (previous, result) => ({ ...result, items: uniqueItems(append ? [...previous.items, ...result.items] : result.items, item => item.entryId ?? item.id) }),
  });
 }
 $effect(() => { get().category; untrack(() => { if (resource.activated) void load(); }); });
 onDestroy(resource.cancel);
 return {
    get pagination() { return { kind: 'cursor' as const, hasMore: resource.data.hasMore }; }, title: 'Friends activity', href: '/friends?view=activity', shape: 'fanart', filters: [], controls: [],
  get items() { return resource.data.items; }, get ready() { return resource.ready; }, get busy() { return resource.busy; },
  get error() { return resource.error; }, get activated() { return resource.activated; },
  empty: 'Activity from friends appears here when they share it.', load };
}
