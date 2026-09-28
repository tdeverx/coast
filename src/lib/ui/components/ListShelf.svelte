<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { MediaView } from '$lib/ui/types';
  import { api, message } from '$lib/ui/client';
  import SequenceControl from './SequenceControl.svelte';
  import Shelf from './Shelf.svelte';
  import MediaTypePicker from './MediaTypePicker.svelte';
  import Button from './Button.svelte';
  import Pagination from './Pagination.svelte';
  type Content = {
    selected?: { playlist: boolean } | null;
    items: MediaView[];
    page: number;
    pages: number;
    total: number;
    kind: 'all' | 'movie' | 'show';
    filter: string;
    scope?: 'all' | 'available';
  };
  let {
    view,
    title,
    custom = false,
    layout = 'row',
    initial,
    onitems,
    ondelete,
  }: {
    view: string;
    title: string;
    custom?: boolean;
    layout?: 'row' | 'grid';
    initial?: Content;
    onitems?: (items: MediaView[], selection: string) => void;
    ondelete?: () => void;
  } = $props();
  let content = $state<Content>(
    untrack(() => initial ?? { items: [], page: 1, pages: 1, total: 0, kind: 'all', filter: 'all' })
  );
  let scope = $state(untrack(() => content.scope ?? 'all'));
  let kind = $state(untrack(() => content.kind));
  const filter = 'all';
  let busy = $state(false),
    error = $state(''),
    ready = $state(!!untrack(() => initial)),
    arranging = $state(false);
  let host: HTMLDivElement;
  let controller: AbortController | undefined;
  const selection = $derived(`${view}:${content.kind}:${content.filter}`);
  const href = (number = 1) =>
    `/lists?${new URLSearchParams({ view, kind, filter, scope, page: String(number) })}`;
  $effect(() => {
    if (ready) onitems?.(content.items, selection);
  });
  async function load(number = 1) {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    busy = true;
    error = '';
    try {
      const result = await api<Content>(
        `lists/content?${new URLSearchParams({ view, kind, filter, scope, page: String(number) })}`,
        undefined,
        'GET',
        { signal: request.signal }
      );
      if (!request.signal.aborted) {
        content = result;
        ready = true;
        if (layout === 'grid') replaceState(href(result.page), page.state);
      }
    } catch (cause) {
      if (!request.signal.aborted) error = message(cause);
    } finally {
      if (!request.signal.aborted) busy = false;
    }
  }
  async function edit(id: string, direction?: number) {
    try {
      if (direction) await api(`lists/${view}/move`, { entryId: id, direction });
      else await api(`lists/${view}/items`, { entryId: id }, 'DELETE');
      await load(content.page);
    } catch (cause) {
      error = message(cause);
    }
  }
  onMount(() => {
    if (initial) return () => controller?.abort();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(host);
    return () => {
      observer.disconnect();
      controller?.abort();
    };
  });
</script>

<div bind:this={host}>
  <Shelf
    {title}
    items={layout === 'row' ? content.items.slice(0, 20) : content.items}
    {layout}
    {busy}
    availableOnly={scope === 'available'}
    onavailability={(available) => {
      scope = available ? 'available' : 'all';
      void load();
    }}
    pageNumber={content.page}
    pages={content.pages}
    onpage={layout === 'grid' ? load : undefined}
    href={layout === 'row' ? href() : undefined}
  >
    {#snippet controls()}<div class="pickers">
        <MediaTypePicker
          compact
          label={`${title} media type`}
          bind:value={kind}
          onchange={() => load()}
        />
      </div>{/snippet}
    {#snippet actions()}
      {#if content.selected?.playlist}<SequenceControl
          source={{ kind: 'playlist', id: view }}
        />{/if}
      {#if error}<span role="alert">{error}</span><Button
          variant="ghost"
          onclick={() => load(content.page)}>Retry</Button
        >{/if}
      {#if custom && layout === 'grid'}<Button
          variant="ghost"
          onclick={() => (arranging = !arranging)}>{arranging ? 'Done' : 'Arrange'}</Button
        ><Button variant="ghost" onclick={ondelete}>Delete list</Button>{/if}
    {/snippet}
    {#snippet details(item)}
      {#if custom && arranging}<div class="order">
          <Button
            variant="ghost"
            icon="left"
            label={`Move ${item.title} earlier`}
            disabled={busy || (content.page === 1 && content.items[0]?.entryId === item.entryId)}
            onclick={() => edit(item.entryId!, -1)}
          />
          <Button
            variant="ghost"
            icon="right"
            label={`Move ${item.title} later`}
            disabled={busy ||
              (content.page === content.pages && content.items.at(-1)?.entryId === item.entryId)}
            onclick={() => edit(item.entryId!, 1)}
          />
          <Button
            variant="ghost"
            icon="close"
            label={`Remove ${item.title} from list`}
            disabled={busy}
            onclick={() => edit(item.entryId!)}
          />
        </div>{/if}
    {/snippet}
    {#snippet empty()}{#if ready && !busy && !error}<p class="muted">
          No titles in this selection.
        </p>{/if}{/snippet}
  </Shelf>
  {#if layout === 'grid'}<Pagination
      page={content.page}
      pages={content.pages}
      pageUrl={href}
      label={`${title} pages`}
    />{/if}
</div>

<style>
  .pickers {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .order {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
  }
</style>
