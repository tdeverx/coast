import {reader} from '$lib/reading/client.svelte';
import { onMount, untrack } from 'svelte';
import { useClient } from '$lib/ui/client-context';
import { heroTitleIds, isHeroTitle } from '$lib/media/hero';
import type { MediaView, MediaHeroPresentation } from '$lib/ui/types';
import { playbackVisible } from '$lib/playback/visibility';
import { presentTrailer } from '$lib/playback/client.svelte';
import { usePlayback } from '$lib/playback/context.svelte';
export type HeroItem = MediaView | MediaHeroPresentation;
export type HeroOptions = {
  item?: HeroItem;
  items?: HeroItem[];
  parents?: MediaView[];
  collection?: { items: HeroItem[]; selection: string; busy?: boolean };
};
export function screenItem(item: HeroItem): item is MediaView { return !('href' in item); }
/** Selection, artwork fallbacks and trailer attachment for a visible hero slot. */
export function createHeroPresentation(get: () => HeroOptions) {
  const { heroPlayer, player, preview } = usePlayback();

  const { api } = useClient();

  let { item, items = [], parents = [], collection } = $derived(get());
  let current = $state(0),
    host = $state<HTMLElement | null>(null),
    backdropFailed = $state(false),
    posterFailed = $state(false),
    logoFailed = $state(false),
    fading = $state(false),
    gestureLocked = false,
    gestureDistance = 0,
    gestureTimer: ReturnType<typeof setTimeout>;
  let mounted = $state(false);
  let chosen = $state<HeroItem | null>(null);
  let previousSelection = '';
  onMount(() => { mounted = true; });
  $effect(() => {
    if (!mounted || !collection || collection.busy) return;
    const ids = heroTitleIds(collection.items);
    const selected = untrack(() => chosen);
    if (collection.selection === previousSelection && ids.includes(selected?.id ?? '')) return;
    const controller = new AbortController();
    const key = collection.selection;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const existing = collection.items.find((candidate) => candidate.id === id && isHeroTitle(candidate));
    if (!id || existing) {
      chosen = existing ?? null;
      previousSelection = key;
    } else {
      // Resolve only the chosen parent, without delaying the page or its rows.
      void api<MediaView[]>(`heroes?ids=${id}`, undefined, 'GET', { signal: controller.signal })
        .then(titles => {
          if (controller.signal.aborted) return;
          chosen = titles.find(isHeroTitle) ?? null;
          previousSelection = key;
        })
        .catch(() => { if (!controller.signal.aborted) chosen = null; });
    }
    return () => controller.abort();
  });
  const active = $derived(collection ? chosen : (items.length ? items[current % items.length] : item));
  const presentation = $derived(parents.find((parent) => parent.kind === 'show') ?? active);
  const titleLogo = $derived(active?.logo ?? presentation?.logo);
  const hasTrailer = $derived(heroPlayer.id === active?.id && !!heroPlayer.url);
  const showingTrailer = $derived(
    hasTrailer && heroPlayer.playing && heroPlayer.ready && heroPlayer.visible
  );
  let mouseIdle = $state(false);
  let controlFocused = $state(false);
  let idleTimer: ReturnType<typeof setTimeout>;
  const chromeDimmed = $derived(showingTrailer && mouseIdle && !controlFocused);
  function noteActivity(event?: PointerEvent) {
    if (event && event.pointerType !== 'mouse') return;
    clearTimeout(idleTimer);
    mouseIdle = false;
    idleTimer = setTimeout(() => (mouseIdle = true), 2200);
  }
  async function step(by: number) {
    if (fading || items.length < 2) return;
    fading = true;
    await new Promise((resolve) => setTimeout(resolve, 160));
    current = (current + by + items.length) % items.length;
    backdropFailed = false;
    posterFailed = false;
    logoFailed = false;
    fading = false;
  }
  function wheel(e: WheelEvent) {
    if (items.length < 2 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    e.preventDefault();
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      gestureLocked = false;
      gestureDistance = 0;
    }, 220);
    if (gestureLocked) return;
    gestureDistance += e.deltaX;
    if (Math.abs(gestureDistance) < 45) return;
    gestureLocked = true;
    void step(gestureDistance > 0 ? 1 : -1);
  }
  $effect(() => {
    const title = active;
    const obscured = playbackVisible(player)||reader.visible;
    if(obscured){if(heroPlayer.id===title?.id)heroPlayer.visible=false;return;}
    backdropFailed = false;
    posterFailed = false;
    logoFailed = false;
    if (preview || !title || !host || !screenItem(title) || (!title.available && !title.trailer)) return;
    const element = host;
    let visible = true,
      cancelled = false,
      delayPassed = false,
      attaching = false;
    const existing = untrack(() => (heroPlayer.id === title.id ? heroPlayer.url : null));
    const attach = async () => {
      if (
        cancelled ||
        attaching ||
        !visible ||
        document.hidden ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        return;
      attaching = true;
      const url =
        existing ||
        title.trailer ||
        (
          await api<{ url: string | null }>(`media/${title.id}/trailer`, undefined, 'GET').catch(
            () => ({ url: null })
          )
        ).url;
      attaching = false;
      if (url && !cancelled && visible) presentTrailer(title.id, url, element.getBoundingClientRect());
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (heroPlayer.id === title.id) heroPlayer.visible = visible;
        if (visible && delayPassed) void attach();
      },
      { threshold: 0.3 }
    );
    observer.observe(element);
    const timer = setTimeout(
      () => {
        delayPassed = true;
        void attach();
      },
      existing ? 0 : 3000
    );
    const reposition = () => {
      if (heroPlayer.id === title.id) heroPlayer.rect = element.getBoundingClientRect();
    };
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
      requestAnimationFrame(() => {
        if (heroPlayer.id === title.id && !document.querySelector(`[data-hero-id="${title.id}"]`))
          heroPlayer.visible = false;
      });
    };
  });
  $effect(() => {
    if (!host) return;
    const element = host;
    element.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('pointermove', noteActivity);
    noteActivity();
    const shell = element.closest<HTMLElement>('.page-shell');
    const resize = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      shell?.style.setProperty('--active-hero-height', `${rect.height}px`);
      if (heroPlayer.id === active?.id) heroPlayer.rect = rect;
    });
    resize.observe(element);
    return () => {
      element.removeEventListener('wheel', wheel);
      document.removeEventListener('pointermove', noteActivity);
      clearTimeout(idleTimer);
      clearTimeout(gestureTimer);
      resize.disconnect();
      shell?.style.removeProperty('--active-hero-height');
    };
  });
  return {
    get active() { return active; },
    get presentation() { return presentation; },
    get titleLogo() { return titleLogo; },
    get hasTrailer() { return hasTrailer; },
    get showingTrailer() { return showingTrailer; },
    get chromeDimmed() { return chromeDimmed; },
    get current() { return current; },
    get fading() { return fading; },
    get host() { return host; }, set host(value) { host = value; },
    get backdropFailed() { return backdropFailed; }, set backdropFailed(value) { backdropFailed = value; },
    get posterFailed() { return posterFailed; }, set posterFailed(value) { posterFailed = value; },
    get logoFailed() { return logoFailed; }, set logoFailed(value) { logoFailed = value; },
    get controlFocused() { return controlFocused; }, set controlFocused(value) { controlFocused = value; },
    noteActivity, step,
  };
}
