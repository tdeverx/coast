<script lang="ts">
  import Pagination from './Pagination.svelte';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page as route } from '$app/state';
  import {
    progressTabs,
    progressTitles,
    type ProgressSurface,
    type ProgressContent,
    type ProgressOptions,
  } from '$lib/progress';
  import { api, message } from '$lib/ui/client';
  import type { MediaView } from '$lib/ui/types';
  import Shelf from './Shelf.svelte';
  import MediaTypePicker from './MediaTypePicker.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import Button from './Button.svelte';
  let {
    initial,
    surface = 'continue',
    username,
    layout = 'row',
    onitems,
  }: {
    initial?: ProgressContent;
    surface?: ProgressSurface;
    username?: string;
    layout?: 'row' | 'grid';
    onitems?: (items: MediaView[], selection: string) => void;
  } = $props();
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
  let container: HTMLDivElement;
  let activated = false;
  let ready = $state(!!untrack(() => initial));
  let tab = $state<string>(untrack(() => initial?.view ?? defaultView()));
  let preferences = $state<Record<string, Filters>>(
    Object.fromEntries(progressTabs.map((option) => [option.value, defaults()]))
  );
  untrack(() => {
    if (initial) preferences[initial.view] = { kind: initial.kind, scope: initial.scope };
  });
  const current = $derived(preferences[tab]);
  let content = $state(untrack(() => initial ?? emptyContent()));
  let busy = $state(false),
    error = $state('');
  let controller: AbortController | undefined;
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
        if (activated) void select(content.page);
        return;
      }
      if (layout === 'grid') {
        tab = next.view;
        preferences[tab] = { kind: next.kind, scope: next.scope };
        controller?.abort();
        content = next;
        busy = false;
      } else if (tab === next.view && current.kind === next.kind && current.scope === next.scope) {
        content = next;
      } else {
        void select();
      }
    });
  });
  $effect(() => {
    onitems?.(content.items, [content.view, content.kind, content.scope].join(':'));
  });
  async function select(number = 1) {
    activated = true;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    busy = true;
    error = '';
    try {
      const result = await api<ProgressContent>(
        'progress?' + parameters(number),
        undefined,
        'GET',
        { signal: request.signal }
      );
      if (!request.signal.aborted) {
        content = result;
        ready = true;
        if (layout === 'grid') replaceState(href(result.page), route.state);
      }
    } catch (cause) {
      if (!request.signal.aborted) error = message(cause);
    } finally {
      if (!request.signal.aborted) busy = false;
    }
  }
  function update(patch: Partial<Filters>) {
    preferences[tab] = { ...current, ...patch };
    void select();
  }
  onMount(() => {
    if (initial) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          if (!activated) void select();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(container);
    return () => observer.disconnect();
  });
  onDestroy(() => controller?.abort());
</script>

<div bind:this={container}>
  <Shelf
    {title}
    items={visible}
    {busy}
    {layout}
    availability={surface !== 'profile'}
    availableOnly={current.scope === 'available'}
    onavailability={(available) => update({ scope: available ? 'available' : 'all' })}
    pageNumber={content.page}
    pages={content.pages}
    onpage={layout === 'grid' ? select : undefined}
    shape={saved ? 'poster' : 'fanart'}
    artworkStyle={saved ? 'auto' : 'thumb'}
    artworkPriority={['watching', 'up-next'].includes(content.view)
      ? 'season-show-episode'
      : undefined}
    href={layout === 'row' ? href() : undefined}
  >
    {#snippet filters()}
      {#if !saved}<div class="selection-controls">
          <SegmentedControl
            label={`${title} selection`}
            bind:value={tab}
            {options}
            onchange={() => select()}
          />
        </div>{/if}
    {/snippet}
    {#snippet controls()}
      <MediaTypePicker
        compact
        label={`${title} media type`}
        value={current.kind}
        onchange={(kind) => update({ kind })}
      />
    {/snippet}
    {#snippet actions()}
      {#if error}<span role="alert">{error}</span><Button variant="ghost" onclick={() => select()}
          >Retry</Button
        >{/if}
    {/snippet}
    {#snippet empty()}{#if ready && !busy && !error}<p class="muted">
          No titles in this selection.
        </p>{/if}{/snippet}
  </Shelf>

  {#if layout === 'grid'}<Pagination
      page={content.page}
      pages={content.pages}
      {busy}
      onchange={select}
      label={`${title} pages`}
    />{/if}
</div>

<style>
  .selection-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
  }
  .selection-controls :global(.picker-container) {
    min-width: 0;
  }
</style>
