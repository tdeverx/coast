import { onDestroy, untrack, type Snippet } from 'svelte';
import { api } from '$lib/ui/client';
import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
import { journalGroups, type JournalEntry } from '$lib/profile/journal';
import type { ShelfSource } from './types';
export type JournalOptions = {
    items?: JournalEntry[];
    endpoint?: string;
    maxDays?: number;
    page?: number;
    pages?: number;
    filters?: Record<string, string | number | boolean | undefined>;
    onitems?: (items: JournalEntry[]) => void;
    selection?: {
      checked: (id: string) => boolean;
      toggle: (id: string) => void;
      disabled?: boolean;
    };
    today: string;
    layout?: 'row' | 'grid';
    preview?: { href: string; filters: Snippet };
  };
export function createJournalSource(getOptions:()=>JournalOptions):ShelfSource {
  let {
    items = [],
    endpoint = 'profile/activity', maxDays = Infinity, page = 0, pages = 1, filters, onitems,
    today,
    preview,
    selection,
  } = $derived(getOptions());

  type Content = { items: JournalEntry[]; page: number; pages: number };
  const resource = createResource<Content>(untrack(() => ({ items, page, pages })), untrack(() => page > 0 || !filters));
  const loadedItems = $derived(filters ? resource.data.items : items);
  const current = $derived(resource.data.page);
  const last = $derived(resource.data.pages);
  const loading = $derived(resource.busy);
  const error = $derived(resource.error);
  const dayOf = (item: JournalEntry) =>
    item.dateKnown === false ? 'unknown' : item.watchedAt.slice(0, 10);
  const days = $derived([...new Set(loadedItems.map(dayOf))]);
  const visible = $derived(loadedItems.filter((item) => days.indexOf(dayOf(item)) < maxDays));
  const hasMore = $derived(!!filters && current < last && days.length <= maxDays);
  async function more() {
    if (loading || !hasMore) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters ?? {}))
      if (value !== undefined) params.set(key, String(value));
    params.set('page', String(current + 1));
    const path = `${endpoint}?${params}`;
    await resource.load(signal => api<Content>(path, undefined, 'GET', { signal }), {
      merge: (previous, next) => ({ ...next, items: uniqueItems([...previous.items, ...next.items], item => item.eventId) }),
    });
  }
  $effect(() => {
    if (current > 0) onitems?.(loadedItems);
  });
  onDestroy(resource.cancel);

  const groups = $derived(journalGroups(visible));
  const visibleGroups = $derived(
    preview && !groups.length ? [{ date: 'unknown', count: 0, runs: [] }] : groups
  );
  const previewTitle = (date: string) =>
    date === today
      ? 'Today'
      : date === new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
        ? 'Yesterday'
        : 'Activity';
  const dayLabel = (date: string) =>
    date === 'unknown'
      ? 'Date unknown'
      : date === today
        ? 'Today'
        : date === new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
          ? 'Yesterday'
          : new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            });
  return {
    title:'Activity', get items() { return visible; }, get busy() { return loading; }, get ready() { return resource.ready; },
    get error() { return error; }, get activated() { return resource.activated; }, filters:[], controls:[],
    get groups() { return visibleGroups.map(group=>({title:preview ? previewTitle(group.date) : `${dayLabel(group.date)} activity`,
      heading:preview ? undefined : dayLabel(group.date), count:preview ? undefined : group.count,
      items:group.runs.flat(), runs:group.runs, href:preview?.href, controls:preview?.filters,
      preserveHeight:!!preview, selection})); },
    get appendOnly() { return !!filters; }, get hasMore() { return hasMore; }, get page() { return current; }, get pages() { return last; },
    get empty() { return !hasMore && !loadedItems.length ? 'No recorded activity in this period.' : ''; },
    loadMoreLabel:'Load more activity', load:more,
  };
}
