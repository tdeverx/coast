<script lang="ts">
  import type { ArtworkPriority, MediaRowStyle } from '$lib/ui/types';
  import { onMount, tick, type Snippet } from 'svelte';
  import RowStyleMenu from './RowStyleMenu.svelte';
  import { contextGesture } from '$lib/ui/context-gesture';
  import type { MediaCardShape, MediaCardArtwork, MediaCardOverlay } from '$lib/ui/types';
  import RowHeader from './RowHeader.svelte';
  import Icon from './Icon.svelte';
  let {
    title,
    heading,
    filters,
    controls,
    actions,
    href,
    children,
    size = 'poster',
    layout = 'row',
    artworkStyle = 'auto',
    overlay = 'none',
    artworkPriority,
    artworkOptions = true,
    busy = false,
    preserveHeight = false,
    rows = 1,
    hasMore = false,
    onend,
    resetKey,
    pageNumber = 1,
    pages = 1,
    onpage,
  }: {
    pageNumber?: number;
    pages?: number;
    onpage?: (page: number) => void;
    rows?: 1 | 2;
    hasMore?: boolean;
    onend?: () => void;
    resetKey?: string;
    title: string;
    heading?: Snippet;
    filters?: Snippet;
    controls?: Snippet;
    actions?: Snippet;
    href?: string;
    children: Snippet<[MediaRowStyle]>;
    artworkStyle?: MediaCardArtwork;
    overlay?: MediaCardOverlay;
    artworkPriority?: ArtworkPriority;
    artworkOptions?: boolean;
    layout?: 'row' | 'grid';
    size?: 'poster' | 'square' | 'fanart' | 'banner' | 'panel';
    busy?: boolean;
    preserveHeight?: boolean;
  } = $props();
  let styleMenu = $state<RowStyleMenu>();
  let overridePriority = $state<ArtworkPriority | null>(null);
  let overrideShape = $state<MediaCardShape | null>(null);
  let overrideArtwork = $state<MediaCardArtwork | null>(null);
  let overrideOverlay = $state<MediaCardOverlay | null>(null);
  const currentSize = $derived(overrideShape ?? size);
  const style = $derived({
    shape: (currentSize === 'panel' ? 'poster' : currentSize) as MediaCardShape,
    artworkStyle: overrideArtwork ?? artworkStyle,
    overlay: overrideOverlay ?? overlay,
    artworkPriority: overridePriority ?? artworkPriority,
  });
  function styleGesture(node: HTMLElement) {
    if (size !== 'panel') return contextGesture(node, (point) => styleMenu?.openAt(point));
  }
  $effect(() => {
    currentSize;
    savedHeight = 0;
    void tick().then(measure);
  });
  let scroller = $state<HTMLDivElement>();
  let previous = $state(false),
    next = $state(false);
  let savedHeight = $state(0);
  let measuredWidth = 0;
  function measure() {
    if (busy) return;
    if (scroller) {
      const width = scroller.clientWidth;
      if (measuredWidth && width !== measuredWidth) {
        savedHeight = 0;
        void tick().then(measure);
      } else if (preserveHeight && layout === 'row')
        savedHeight = Math.max(savedHeight, scroller.getBoundingClientRect().height);
      measuredWidth = width;
      previous = scroller.scrollLeft > 1;
      next = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    }
  }
  $effect(() => {
    if (!busy) void tick().then(measure);
  });
  $effect(() => {
    resetKey;
    if (scroller) scroller.scrollLeft = 0;
  });
  function reachedEnd() {
    measure();
    if (
      !busy &&
      hasMore &&
      scroller &&
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 300
    )
      onend?.();
  }
  function scroll(direction: number) {
    if (direction > 0 && !next && hasMore && !busy) onend?.();
    scroller?.scrollBy({
      left: direction * scroller.clientWidth * 0.8,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  onMount(() => {
    const resize = new ResizeObserver(measure),
      changes = new MutationObserver(measure);
    resize.observe(scroller!);
    changes.observe(scroller!, { childList: true, subtree: true });
    measure();
    return () => {
      resize.disconnect();
      changes.disconnect();
    };
  });
</script>

<section class="content-row section" aria-label={title} aria-busy={busy}>
  <div use:styleGesture>
    <RowHeader {title} {heading} {filters} {actions} {href}>
      {#snippet navigation()}{#if layout === 'row' || controls || onpage}<div class="navigation">
            {#if layout === 'row' || onpage}
              <button
                class="icon-button"
                aria-label={layout === 'grid' ? `Previous ${title} page` : `Scroll ${title} left`}
                disabled={layout === 'grid' ? busy || pageNumber <= 1 : !previous}
                onclick={() => (layout === 'grid' ? onpage?.(pageNumber - 1) : scroll(-1))}
                ><Icon name="left" /></button
              >{/if}
            {#if controls}<div class="row-controls">{@render controls()}</div>{/if}
            {#if layout === 'row' || onpage}
              <button
                class="icon-button"
                aria-label={layout === 'grid' ? `Next ${title} page` : `Scroll ${title} right`}
                disabled={layout === 'grid' ? busy || pageNumber >= pages : !next && !hasMore}
                onclick={() => (layout === 'grid' ? onpage?.(pageNumber + 1) : scroll(1))}
                ><Icon name="right" /></button
              >{/if}
          </div>{/if}{/snippet}
    </RowHeader>
  </div>
  {#if size !== 'panel'}<RowStyleMenu
      bind:this={styleMenu}
      {title}
      shape={size}
      {artworkStyle}
      {overlay}
      {artworkOptions}
      bind:overridePriority
      bind:overrideShape
      bind:overrideArtwork
      bind:overrideOverlay
    />{/if}
  <div
    class="rail"
    class:two-rows={rows === 2 && layout === 'row'}
    class:grid-layout={layout === 'grid'}
    class:preserve={preserveHeight}
    class:square={currentSize === 'square'}
    style:min-height={layout === 'row' && preserveHeight && savedHeight
      ? `${savedHeight}px`
      : undefined}
    class:fanart={currentSize === 'fanart'}
    class:banner={currentSize === 'banner'}
    class:panel-row={currentSize === 'panel'}
    bind:this={scroller}
    onscroll={reachedEnd}
  >
    {@render children(style)}
  </div>
</section>

<style>
  .content-row {
    min-width: 0;
  }
  .rail {
    --row-card-width: clamp(155px, 14vw, 210px);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: min(100%, var(--row-card-width));
    align-items: start;
    gap: 20px;
    overflow: auto;
    padding: 24px var(--gutter);
    margin: -24px calc(-1 * var(--gutter));
    scroll-padding-inline: var(--gutter);
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    scroll-snap-type: x proximity;
  }
  .rail :global(> *) {
    min-width: 0;
    scroll-snap-align: start;
  }
  .preserve {
    min-height: calc(var(--row-card-width) * 1.5 + 108px);
  }
  .two-rows.preserve {
    min-height: calc((var(--row-card-width) * 1.5 + 108px) * 2 + 20px);
  }
  .two-rows.preserve.square {
    min-height: calc((var(--row-card-width) + 108px) * 2 + 20px);
  }
  .preserve.square {
    min-height: calc(var(--row-card-width) + 108px);
  }
  .preserve.fanart {
    min-height: calc(var(--row-card-width) * 0.5625 + 108px);
  }
  .preserve.banner {
    min-height: calc(var(--row-card-width) * 0.185 + 108px);
  }
  .preserve.panel-row {
    min-height: 380px;
  }
  .fanart {
    --row-card-width: clamp(255px, 27vw, 380px);
  }
  .banner {
    --row-card-width: clamp(310px, 34vw, 480px);
  }
  .panel-row {
    --row-card-width: 360px;
    grid-auto-columns: min(calc(100% - 24px), 440px);
    align-items: stretch;
  }
  .two-rows {
    grid-template-rows: repeat(2, auto);
  }
  .grid-layout {
    grid-auto-flow: row;
    grid-auto-columns: auto;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--row-card-width)), 1fr));
    overflow: visible;
    scroll-snap-type: none;
  }
  .grid-layout :global(.row-empty) {
    grid-column: 1 / -1;
  }
  .row-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: center;
  }
  .navigation {
    align-items: center;
    min-width: 0;
    display: flex;
    gap: 2px;
  }
  .navigation .icon-button {
    width: var(--control-compact-height);
    height: var(--control-compact-height);
    color: var(--muted);
  }
  .navigation .icon-button:disabled {
    opacity: 0.25;
  }
  @media (max-width: 500px) {
    .rail {
      gap: 14px;
    }
    .rail:not(.fanart):not(.banner):not(.panel-row) {
      --row-card-width: 145px;
    }
  }
</style>
