<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { api, message } from '$lib/ui/client';
  import type { JournalEntry } from '$lib/profile/journal';
  import WatchJournal from './WatchJournal.svelte';
  import Button from './Button.svelte';
  let {
    endpoint = 'profile/activity',
    maxDays = Infinity,
    layout = 'row',
    initial = [],
    page = 0,
    pages = 1,
    today,
    filters,
    onitems,
    preview,
    selection,
  }: {
    endpoint?: string;
    selection?: {
      checked: (id: string) => boolean;
      toggle: (id: string) => void;
      disabled?: boolean;
    };
    preview?: { href: string; filters: Snippet };
    onitems?: (items: JournalEntry[]) => void;
    maxDays?: number;
    layout?: 'row' | 'grid';
    initial?: JournalEntry[];
    page?: number;
    pages?: number;
    today: string;
    filters: Record<string, string | number | boolean | undefined>;
  } = $props();
  let items = $state<JournalEntry[]>(untrack(() => initial));
  let current = $state(untrack(() => page));
  let last = $state(untrack(() => pages));
  let loading = $state(false),
    error = $state('');
  let sentinel: HTMLDivElement;
  const dayOf = (item: JournalEntry) =>
    item.dateKnown === false ? 'unknown' : item.watchedAt.slice(0, 10);
  const days = $derived([...new Set(items.map(dayOf))]);
  const visible = $derived(items.filter((item) => days.indexOf(dayOf(item)) < maxDays));
  const hasMore = $derived(current < last && days.length <= maxDays);
  const controller = new AbortController();
  async function more() {
    if (loading || !hasMore) return;
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined) params.set(key, String(value));
      params.set('page', String(current + 1));
      const data = await api<{ items: JournalEntry[]; page: number; pages: number }>(
        `${endpoint}?${params}`,
        undefined,
        'GET',
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      const seen = new Set(items.map((item) => item.eventId));
      items = [...items, ...data.items.filter((item) => !seen.has(item.eventId))];
      current = data.page;
      last = data.pages;
    } catch (cause) {
      if (!controller.signal.aborted) error = message(cause);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    if (current > 0) onitems?.(items);
  });
  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') {
      void more();
      return () => controller.abort();
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !error) void more();
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  });
</script>

<WatchJournal items={visible} {today} {layout} {preview} {selection} />
<div bind:this={sentinel} class="load-more" aria-busy={loading} aria-live="polite">
  {#if error}<p role="alert">{error}</p>{/if}
  {#if hasMore && !loading}<Button variant="ghost" disabled={loading} onclick={more}>
      {error ? 'Retry' : 'Load more activity'}
    </Button>
  {:else if !hasMore && !items.length}<p class="muted">No recorded activity in this period.</p>{/if}
</div>

<style>
  .load-more {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding-block: 18px;
  }
</style>
