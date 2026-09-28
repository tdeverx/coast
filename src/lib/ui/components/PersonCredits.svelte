<script lang="ts">
  import { page as route } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { api, message } from '$lib/ui/client';
  import type { MediaView } from '$lib/ui/types';
  import type { creditRoles } from '$lib/media/credits';
  import Shelf from './Shelf.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';
  let {
    personId,
    title,
    scope = 'all',
    layout = 'row',
  }: {
    layout?: 'row' | 'grid';
    personId: number;
    title: string;
    scope?: 'all' | 'library' | 'known';
  } = $props();
  let root: HTMLDivElement;
  let result = $state<{
    items: (MediaView & { creditRoles?: ReturnType<typeof creditRoles> })[];
    page: number;
    pages: number;
    total: number;
    departments?: string[];
  }>({
    items: [],
    page: 1,
    pages: 1,
    total: 0,
  });
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
    ),
    busy = $state(true),
    ready = $state(false),
    error = $state('');
  let request: AbortController | undefined;
  const cache = new Map<string, typeof result>();
  async function load(page = 1) {
    request?.abort();
    const current = new AbortController();
    request = current;
    const key = `${type}:${department}:${available}:${page}`;
    const cached = cache.get(key);
    if (cached) {
      result = cached;
      busy = false;
      ready = true;
      error = '';
      return;
    }
    busy = true;
    error = '';
    try {
      const response = await api<typeof result>(
        `people/${personId}/credits?${new URLSearchParams({ scope, type, department, available: String(available), page: String(page) })}`,
        undefined,
        'GET',
        { signal: current.signal }
      );
      if (!current.signal.aborted) {
        result =
          page > 1 && layout === 'row'
            ? {
                ...response,
                items: [
                  ...new Map(
                    [...result.items, ...response.items].map((item) => [item.id, item])
                  ).values(),
                ],
              }
            : response;
        cache.set(layout === 'row' ? `${type}:${department}:${available}:1` : key, result);
        ready = true;
      }
    } catch (e) {
      if (!current.signal.aborted) error = message(e);
    } finally {
      if (!current.signal.aborted) busy = false;
    }
  }
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      request?.abort();
    };
  });
</script>

<div bind:this={root} class="credits">
  <Shelf
    {title}
    items={result.items}
    {busy}
    {layout}
    href={layout === 'row'
      ? `/people/${personId}?${new URLSearchParams({ section: scope, type, department, available: String(available) })}`
      : undefined}
    availability={scope !== 'library'}
    availableOnly={available}
    onavailability={(value) => {
      available = value;
      void load();
    }}
    pageNumber={result.page}
    pages={result.pages}
    onpage={layout === 'grid' ? load : undefined}
    rows={scope === 'all' ? 2 : 1}
    hasMore={layout === 'row' && scope !== 'known' && result.page < result.pages}
    onend={() => {
      if (!busy) void load(result.page + 1);
    }}
    resetKey={`${type}:${department}`}
  >
    {#snippet filters()}<SegmentedControl
        label={`${title} roles`}
        bind:value={department}
        options={[
          { value: 'all', label: 'All' },
          ...(result.departments ?? ['Acting', 'Crew']).map((label) => ({ value: label, label })),
        ]}
        onchange={() => load()}
      />{/snippet}
    {#snippet controls()}<RowFilter
        label={`${title} type`}
        bind:value={type}
        onchange={() => load()}
        options={[
          { value: 'all', label: 'All' },
          { value: 'movie', label: 'Movies' },
          { value: 'show', label: 'Shows' },
        ]}
      />{/snippet}
    {#snippet details(item)}
      {@const roles = rolesById.get(item.id)}
      {#if roles && roles.remaining > 0}
        <details class="credit-roles">
          <summary>View all roles</summary>
          <p>{roles.full}</p>
        </details>
      {/if}
    {/snippet}
    {#snippet empty()}{#if error}<div class="stack">
          <p>{error}</p>
          <Button variant="ghost" onclick={() => load()}>Try again</Button>
        </div>{:else if ready}<p class="muted">
          {scope === 'library'
            ? 'No available titles in your library.'
            : 'No credits match these filters.'}
        </p>{/if}{/snippet}
  </Shelf>
  {#if error && result.items.length}<div class="notice">
      <p>{error}</p>
      <Button variant="ghost" onclick={() => load()}>Try again</Button>
    </div>{/if}
</div>

<style>
  .credits {
    min-height: 120px;
  }
  .credit-roles {
    margin-top: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .credit-roles summary {
    cursor: pointer;
    font-weight: 600;
  }
  .credit-roles p {
    margin-top: 8px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
</style>
