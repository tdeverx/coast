<script lang="ts">
  import { page } from '$app/state';
  import AvailabilityToggle from './AvailabilityToggle.svelte';
  import type { ArtworkPriority } from '$lib/ui/types';
  import RowFilter from './RowFilter.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import ContentRow from './ContentRow.svelte';
  import { untrack, type Snippet } from 'svelte';
  import type {
    MediaView,
    MediaCardShape,
    MediaCardArtwork,
    MediaCardOverlay,
  } from '$lib/ui/types';
  import MediaCard from './MediaCard.svelte';
  let {
    title,
    items,
    href,
    shape = 'poster',
    layout = 'row',
    artworkStyle = 'auto',
    overlay = 'none',
    artworkPriority,
    heading,
    filters,
    controls,
    actions,
    empty,
    busy = false,
    details,
    filterBy = 'type',
    availability = true,
    availableOnly = $bindable(false),
    onavailability,
    pageNumber,
    pages,
    onpage,
    rows = 1,
    hasMore = false,
    onend,
    resetKey,
  }: {
    availability?: boolean;
    availableOnly?: boolean;
    onavailability?: (value: boolean) => void;
    pageNumber?: number;
    pages?: number;
    onpage?: (page: number) => void;
    rows?: 1 | 2;
    hasMore?: boolean;
    onend?: () => void;
    resetKey?: string;
    filterBy?: 'type' | 'watched';
    layout?: 'row' | 'grid';
    heading?: Snippet;
    filters?: Snippet;
    controls?: Snippet;
    actions?: Snippet;
    empty?: Snippet;
    busy?: boolean;
    details?: Snippet<[MediaView]>;
    title: string;
    items: MediaView[];
    href?: string;
    shape?: MediaCardShape;
    artworkStyle?: MediaCardArtwork;
    overlay?: MediaCardOverlay;
    artworkPriority?: ArtworkPriority;
  } = $props();
  // Keep the last completed selection visible while its replacement is being fetched.
  let settledItems = $state<MediaView[]>(untrack(() => items));
  let selection = $state(
    untrack(() => (layout === 'grid' ? (page.url.searchParams.get('rowProgress') ?? 'all') : 'all'))
  );
  let kind = $state(
    untrack(() => (layout === 'grid' ? (page.url.searchParams.get('rowKind') ?? 'all') : 'all'))
  );
  untrack(() => {
    if (layout === 'grid' && page.url.searchParams.get('rowAvailable') === 'true')
      availableOnly = true;
  });
  const titleHref = $derived.by(() => {
    if (!href) return undefined;
    const url = new URL(href, page.url);
    if (!controls) url.searchParams.set(url.pathname === '/library' ? 'kind' : 'rowKind', kind);
    if (filterBy === 'watched') url.searchParams.set('rowProgress', selection);
    if (availability && !onavailability) {
      if (url.pathname === '/library')
        url.searchParams.set('scope', availableOnly ? 'available' : 'all');
      else url.searchParams.set('rowAvailable', String(availableOnly));
    }
    return url.pathname + url.search;
  });
  const sourceItems = $derived(busy ? settledItems : items);
  const typeOptions = $derived([
    { value: 'all', label: 'All' },
    ...[
      { value: 'movie', label: 'Movies' },
      { value: 'show', label: 'Shows' },
      { value: 'season', label: 'Seasons' },
      { value: 'episode', label: 'Episodes' },
      { value: 'collection', label: 'Collections' },
    ].filter((option) => sourceItems.some((item) => item.kind === option.value)),
  ]);
  const visibleItems = $derived(
    sourceItems.filter(
      (item) =>
        (!availability || onavailability || !availableOnly || item.available) &&
        (controls || kind === 'all' || item.kind === kind) &&
        (filterBy !== 'watched' ||
          selection === 'all' ||
          item.watched === (selection === 'watched'))
    )
  );

  $effect(() => {
    if (!busy) settledItems = items;
  });
  $effect(() => {
    if (!controls && !typeOptions.some((option) => option.value === kind)) kind = 'all';
  });
</script>

{#snippet rowFilters()}
  {@render filters?.()}
  {#if filterBy === 'watched'}<SegmentedControl
      label={`${title} progress`}
      bind:value={selection}
      options={[
        { value: 'all', label: 'All' },
        { value: 'unwatched', label: 'Unwatched' },
        { value: 'watched', label: 'Watched' },
      ]}
    />{/if}
  {#if availability}<AvailabilityToggle
      value={availableOnly}
      onchange={(value) => {
        availableOnly = value;
        onavailability?.(value);
      }}
    />{/if}
{/snippet}
{#snippet rowControls()}
  {@render controls?.()}
  {#if !controls}<RowFilter label={`${title} type`} bind:value={kind} options={typeOptions} />{/if}
{/snippet}

{#if sourceItems.length || heading || filters || empty}<ContentRow
    {title}
    href={titleHref}
    {actions}
    filters={filters || filterBy === 'watched' || availability ? rowFilters : undefined}
    controls={rowControls}
    {heading}
    size={shape}
    {artworkStyle}
    {overlay}
    {artworkPriority}
    {layout}
    {pageNumber}
    {pages}
    {onpage}
    {rows}
    {hasMore}
    {onend}
    resetKey={resetKey ?? `${selection}:${kind}:${availableOnly}`}
    {busy}
    preserveHeight={!!filters || !!heading || !!controls || !!filterBy}
  >
    {#snippet children(style)}
      {#each visibleItems as item (item.entryId ?? item.id)}<div class="shelf-item">
          <MediaCard
            {item}
            shape={style.shape}
            artworkStyle={style.artworkStyle}
            overlay={style.overlay}
            artworkPriority={style.artworkPriority}
          />{#if details}{@render details(item)}{/if}
        </div>{/each}
      {#if !busy && !visibleItems.length && (empty || filterBy)}<div
          class="row-empty"
          aria-live="polite"
        >
          {#if selection !== 'all' || kind !== 'all' || availableOnly}<p class="muted">
              No titles in this selection.
            </p>{:else}{@render empty?.()}{/if}
        </div>{/if}
    {/snippet}
  </ContentRow>{/if}
