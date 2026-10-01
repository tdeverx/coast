import { tick, untrack } from 'svelte';
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
    if (measuredWidth && width !== measuredWidth) {
      savedHeight = 0;
      void tick().then(measure);
    } else if (config.preserveHeight && config.layout === 'row' && size === 'panel') {
      savedHeight = Math.max(savedHeight, scroller.getBoundingClientRect().height);
    }
    measuredWidth = width;
    previous = scroller.scrollLeft > 1;
    next = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
  }
  function reachedEnd() {
    measure();
    const config = get();
    if (!config.busy && config.hasMore && scroller && scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 300)
      config.onend?.();
  }
  function scroll(direction: number) {
    const config = get();
    if (direction > 0 && !next && config.hasMore && !config.busy) config.onend?.();
    scroller?.scrollBy({
      left: direction * scroller.clientWidth * 0.8,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  $effect(() => { size; savedHeight = 0; void tick().then(measure); });
  $effect(() => { if (!get().busy) void tick().then(measure); });
  $effect(() => { get().resetKey; if (scroller) scroller.scrollLeft = 0; });
  $effect(() => {
    if (!scroller) return;
    return untrack(() => {
      const resize = new ResizeObserver(measure);
      const changes = new MutationObserver(measure);
      resize.observe(scroller!);
      changes.observe(scroller!, { childList: true, subtree: true });
      measure();
      return () => { resize.disconnect(); changes.disconnect(); };
    });
  });

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
    reachedEnd, scroll,
  };
}
