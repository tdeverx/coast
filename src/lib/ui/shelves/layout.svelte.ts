import { onDestroy, tick, untrack } from 'svelte';
import type { ArtworkPriority, MediaCardArtwork, MediaCardOverlay, MediaCardShape, MediaRowStyle } from '$lib/ui/types';

type LayoutOptions = {
  size: MediaCardShape | 'panel';
  artworkStyle: MediaCardArtwork;
  artworkPriority?: ArtworkPriority;
  overlay: MediaCardOverlay;
  layout: 'row' | 'grid';
  busy: boolean;
  preserveHeight: boolean;
  hasMore: boolean;
  hasPrevious?: boolean;
  onstart?: () => Promise<unknown>;
  initialItemId?: string;
  onend?: () => void;
  resetKey?: string;
};

/** Geometry, scroll state and user presentation choices for the single shelf rail. */
export function createShelfLayout(get: () => LayoutOptions) {
  let scroller = $state<HTMLDivElement>();
  let overridePriority = $state<ArtworkPriority | null>(null);
  let overrideShape = $state<MediaCardShape | null>(null);
  let overrideArtwork = $state<MediaCardArtwork | null>(null);
  let overrideOverlay = $state<MediaCardOverlay | null>(null);
  let previous = $state(false);
  let next = $state(false);
  let savedHeight = $state(0);
  let measuredWidth = 0;
  let anchoredWidth = 0;
  let frame = 0;
  let endRequested = false;
  let startRequested = false;
  let loadingPrevious = false;
  let lastScrollLeft = 0;
  let positionedId: string | undefined;
  let resetScroller: HTMLDivElement | undefined;
  let previousResetKey: string | undefined;
  let destroyed = false;
  const resetKey = $derived(get().resetKey);
  const initialItemId = $derived(get().initialItemId);
  const busy = $derived(get().busy);
  const layout = $derived(get().layout);
  const size = $derived(overrideShape ?? get().size);
  const style = $derived<MediaRowStyle>({
    shape: size === 'panel' ? 'poster' : size,
    artworkStyle: overrideArtwork ?? get().artworkStyle,
    overlay: overrideOverlay ?? get().overlay,
    artworkPriority: overridePriority ?? get().artworkPriority,
  });

  function measure() {
    const config = get();
    if (config.busy || !scroller) return;
    const width = scroller.clientWidth;
    const left = scroller.scrollLeft;
    let total = scroller.scrollWidth;
    if (config.initialItemId && config.layout === 'row') {
      if (width !== anchoredWidth) {scroller.style.setProperty('--shelf-viewport-width', `${width}px`);anchoredWidth=width;}
      const last = scroller.lastElementChild as HTMLElement | null;
      // The positioning tail lets the final episode snap to the first slot, but
      // it is not another card or a reason to defer the next lazy page.
      if (last) total = Math.max(width, last.getBoundingClientRect().right - scroller.getBoundingClientRect().left + left);
    }
    if (measuredWidth && width !== measuredWidth) {
      savedHeight = 0;
      void tick().then(schedule);
    } else if (config.preserveHeight && config.layout === 'row' && size === 'panel') {
      savedHeight = Math.max(savedHeight, scroller.getBoundingClientRect().height);
    }
    measuredWidth = width;
    previous = left > 1;
    next = left + width < total - 1;
    return { left, width, total };
  }
  function schedule() {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed) return;
      const bounds = measure();
      const reached = endRequested;
      const start = startRequested;
      endRequested = false;
      startRequested = false;
      const config = get();
      if (start && bounds && bounds.left <= 300 && config.hasPrevious && !config.busy)
        void prepend();
      else if (reached && bounds && !config.busy && config.hasMore && bounds.left + bounds.width >= bounds.total - 300)
        config.onend?.();
    });
  }
  function reachedEnd() {
    if (scroller) {
      startRequested ||= scroller.scrollLeft < lastScrollLeft;
      lastScrollLeft = scroller.scrollLeft;
    }
    endRequested = true;
    schedule();
  }
  async function prepend() {
    const config = get(), node = scroller;
    if (destroyed || loadingPrevious || config.busy || !config.hasPrevious || !config.onstart || !node) return;
    loadingPrevious = true;
    const anchor = node.querySelector<HTMLElement>('[data-shelf-id]');
    const left = anchor?.getBoundingClientRect().left;
    try {
      await config.onstart();
      await tick();
      // Keep the visible cards still when an earlier page is inserted before them.
      if (!destroyed && scroller === node && anchor?.isConnected && left !== undefined) {
        node.scrollLeft += anchor.getBoundingClientRect().left - left;
        lastScrollLeft = node.scrollLeft;
        schedule();
      }
    } finally { loadingPrevious = false; }
  }
  function wheel(event: WheelEvent) {
    if ((event.deltaX < 0 || event.shiftKey && event.deltaY < 0) && scroller && scroller.scrollLeft <= 1)
      void prepend();
  }
  function scroll(direction: number) {
    const config = get();
    if (direction < 0 && !previous && config.hasPrevious) { void prepend(); return; }
    if (direction > 0 && !next && config.hasMore && !config.busy) config.onend?.();
    scroller?.scrollBy({
      left: direction * scroller.clientWidth * 0.8,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  $effect(() => { size; savedHeight = 0; void tick().then(schedule); });
  $effect(() => { if (!busy) void tick().then(schedule); });
  $effect(() => {
    const key = resetKey, node = scroller;
    if (!node || node === resetScroller && key === previousResetKey) return;
    if (node !== resetScroller) anchoredWidth = 0;
    resetScroller = node; previousResetKey = key; positionedId = undefined;
    node.scrollLeft = 0; lastScrollLeft = 0;
  });
  $effect(() => {
    const targetId = initialItemId, key = resetKey, node = scroller;
    if (!node || !targetId || busy || layout !== 'row' || targetId === positionedId) return;
    void tick().then(() => {
      if (destroyed || scroller !== node || get().busy || get().initialItemId !== targetId || get().resetKey !== key) return;
      const target = [...node.querySelectorAll<HTMLElement>('[data-shelf-id]')].find(item => item.dataset.shelfId === targetId);
      if (!target) return;
      const padding = parseFloat(getComputedStyle(node).scrollPaddingLeft) || 0;
      node.scrollLeft += target.getBoundingClientRect().left - node.getBoundingClientRect().left - padding;
      positionedId = targetId;
      lastScrollLeft = node.scrollLeft;
      schedule();
    });
  });
  $effect(() => {
    if (!scroller) return;
    return untrack(() => {
      const resize = new ResizeObserver(schedule);
      const changes = new MutationObserver(schedule);
      resize.observe(scroller!);
      changes.observe(scroller!, { childList: true, subtree: true });
      measure();
      return () => { cancelAnimationFrame(frame); frame = 0; endRequested = false; startRequested = false; resize.disconnect(); changes.disconnect(); };
    });
  });
  onDestroy(() => { destroyed = true; if (frame) cancelAnimationFrame(frame); });

  return {
    get scroller() { return scroller; }, set scroller(value) { scroller = value; },
    get overridePriority() { return overridePriority; }, set overridePriority(value) { overridePriority = value; },
    get overrideShape() { return overrideShape; }, set overrideShape(value) { overrideShape = value; },
    get overrideArtwork() { return overrideArtwork; }, set overrideArtwork(value) { overrideArtwork = value; },
    get overrideOverlay() { return overrideOverlay; }, set overrideOverlay(value) { overrideOverlay = value; },
    get size() { return size; },
    get style() { return style; },
    get previous() { return previous; },
    get next() { return next; },
    get savedHeight() { return savedHeight; },
    reachedEnd, scroll, wheel,
  };
}
