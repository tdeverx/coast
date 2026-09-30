<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { page as route } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { api, message } from '$lib/ui/client';
  import {
    libraryTitles,
    librarySelections,
    type LibraryContent,
    type LibrarySurface,
  } from '$lib/library';
  import Shelf from './Shelf.svelte';
  import ContentRow from './ContentRow.svelte';
  import MediaCard from './MediaCard.svelte';
  import MediaTypePicker from './MediaTypePicker.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import Button from './Button.svelte';
  import Pagination from './Pagination.svelte';
  let {
    surface,
    initial,
    genre = '',
    layout = 'row',
    initialSelection = 'all',
    initialKind = 'all',
    initialScope = 'available',
  }: {
    surface: LibrarySurface;
    initial?: LibraryContent;
    genre?: string;
    layout?: 'row' | 'grid';
    initialSelection?: string;
    initialKind?: 'all' | 'movie' | 'show';
    initialScope?: 'all' | 'available';
  } = $props();
  const title = $derived(libraryTitles[surface]);
  let selection = $state(untrack(() => initialSelection)),
    kind = $state(untrack(() => initialKind)),
    scope = $state(untrack(() => initialScope));
  let content = $state<LibraryContent>(
    untrack(() => initial ?? { items: [], page: 1, pages: 1, total: 0 })
  );
  let busy = $state(false),
    failure = $state(''),
    ready = $state(!!untrack(() => initial));
  let host: HTMLDivElement,
    activated = false,
    controller: AbortController | undefined;
  const watchItems = $derived(content.items.filter((item) => 'available' in item));
  const presentations = $derived(content.items.filter((item) => 'href' in item));
  const parameters = (number = 1) =>
    new URLSearchParams({ surface, selection, kind, scope, genre, page: String(number) });
  function href(number = 1) {
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
    activated = true;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    busy = true;
    failure = '';
    try {
      const result = await api<LibraryContent>('library?' + parameters(number), undefined, 'GET', {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      if (result.failure) {
        failure = result.failure;
        return;
      }
      const combined = append ? [...content.items, ...result.items] : result.items;
      const unique = new Map(combined.map((item) => ['href' in item ? item.href : item.id, item]));
      content = { ...result, items: [...unique.values()] };
      ready = true;
      if (layout === 'grid') replaceState(href(result.page), route.state);
    } catch (cause) {
      if (!request.signal.aborted) failure = message(cause);
    } finally {
      if (!request.signal.aborted) busy = false;
    }
  }
  function more() {
    if (ready && !busy && content.page < content.pages) void load(content.page + 1, true);
  }
  $effect(() => {
    route.data;
    const next = initial;
    untrack(() => {
      if (next && layout === 'grid') content = next;
      else if (activated) void load();
    });
  });
  onMount(() => {
    if (initial) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          if (!activated) void load();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(host);
    return () => observer.disconnect();
  });
  onDestroy(() => controller?.abort());
</script>

{#snippet selectionPicker()}<SegmentedControl
    label={`${title} selection`}
    value={selection}
    options={librarySelections[surface]}
    onchange={(value) => {
      selection = value;
      void load();
    }}
  />{/snippet}
{#snippet errors()}{#if failure}<span role="alert">{failure}</span><Button
      variant="ghost"
      onclick={() => load()}>Try again</Button
    >{/if}{/snippet}
<div bind:this={host}>
  {#if surface === 'watch'}
    <Shelf
      {title}
      items={watchItems}
      {layout}
      {busy}
      rows={2}
      filters={selectionPicker}
      actions={errors}
      href={layout === 'row' ? href() : undefined}
      availableOnly={scope === 'available'}
      onavailability={(available) => {
        scope = available ? 'available' : 'all';
        void load();
      }}
      hasMore={content.page < content.pages}
      onend={more}
      resetKey={`${selection}:${kind}:${scope}`}
    >
      {#snippet controls()}<MediaTypePicker
          compact
          label="Watch type"
          value={kind}
          onchange={(value) => {
            kind = value;
            void load();
          }}
        />{/snippet}
      {#snippet empty()}{#if !failure}<p class="muted" role="status">
            {ready ? 'No titles in this selection.' : 'Loading titles…'}
          </p>{/if}{/snippet}
    </Shelf>
  {:else}
    <ContentRow
      {title}
      {layout}
      {busy}
      rows={2}
      preserveHeight
      size={surface === 'listen' ? 'square' : 'poster'}
      filters={selectionPicker}
      actions={errors}
      href={href()}
      hasMore={content.page < content.pages}
      onend={more}
      resetKey={selection}
    >
      {#snippet children(style)}{#each presentations as item (item.href)}<MediaCard
            {item}
            {...style}
          />{/each}
        {#if !presentations.length && !failure}<p class="row-empty muted" role="status">
            {ready ? 'No titles in this selection.' : 'Loading titles…'}
          </p>{/if}
      {/snippet}
    </ContentRow>
  {/if}
  {#if layout === 'grid'}<Pagination
      page={content.page}
      pages={content.pages}
      {busy}
      onchange={(number) => load(number)}
      label={`${title} pages`}
    />{/if}
</div>
