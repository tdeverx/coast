import { onDestroy, tick, untrack } from 'svelte';
import type { ArtworkPriority, MediaCardArtwork, MediaCardOverlay, MediaCardShape, MediaRowStyle } from '#lib/ui/types.js';
import {captureShelfPosition,restoreShelfPosition,shelfScrollOwner,type ShelfPosition} from '../shelf-position';

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
  items?:readonly string[];
  restoration?:ShelfPosition;
  autoLoad?:boolean;
  error?:string;
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
  const items = $derived(get().items);
  const restoration = $derived(get().restoration);
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
    // Back may load while the sheet is still at its compact width. Its existing
    // expansion ResizeObserver supplies the final geometry on the same frame budget.
    if(config.layout==='grid'&&width>0&&config.restoration===restored&&restored
      &&width!==restoredWidth&&!restorationCancelled) {
      restoreShelfPosition(scroller,'grid',restored);
      restoredWidth=width;
    }
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
      if(config.layout==='grid'&&scroller) {
        if(config.busy||config.error)return;
        const rect=scroller.getBoundingClientRect(),owner=shelfScrollOwner(scroller),viewport=owner.getBoundingClientRect();
        const top=Math.max(0,viewport.top),bottom=Math.min(innerHeight,viewport.bottom);
        if(start&&rect.top>=top-300&&config.hasPrevious)void prepend();
        else if(config.autoLoad&&config.hasMore&&rect.bottom<=bottom+300&&rect.top<bottom)config.onend?.();
        return;
      }
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
    try {
      await config.onstart();
      await tick();
      if (!destroyed && scroller === node) {
        lastScrollLeft = node.scrollLeft;
        schedule();
      }
    } finally { loadingPrevious = false; }
  }
  function wheel(event: WheelEvent) {
    if(get().layout==='grid'&&event.deltaY<0&&scroller) {
      const owner=shelfScrollOwner(scroller),top=Math.max(0,owner.getBoundingClientRect().top);
      if(scroller.getBoundingClientRect().top>=top-300)void prepend();
      return;
    }
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
  // Capture immediately before the keyed DOM changes, after any scroll during
  // the request. Reuse the same surviving visible card for append, prepend and refresh.
  let anchoredScroller:HTMLDivElement|undefined, anchoredKey:string|undefined;
  $effect.pre(()=>{
    const nextItems=items,key=resetKey,node=scroller;
    const same=anchoredScroller===node&&anchoredKey===key;
    anchoredScroller=node;anchoredKey=key;
    if(!node||!same||!nextItems)return;
    const mode=untrack(()=>get().layout),position=untrack(()=>captureShelfPosition(node,mode,nextItems));
    if(!position)return;
    void tick().then(()=>{
      if(!destroyed&&scroller===node&&get().resetKey===key) {
        restoreShelfPosition(node,mode,position);lastScrollLeft=node.scrollLeft;schedule();
      }
    });
  });
  let restored:ShelfPosition|undefined, restoredWidth=0, restorationCancelled=false;
  $effect(()=>{
    const position=restoration,node=scroller;
    if(!position||!node)return;
    restorationCancelled=false;
    const host=node.closest('dialog')??node;
    const intent=()=>{restorationCancelled=true;};
    for(const name of ['pointerdown','keydown','wheel'])host.addEventListener(name,intent,{passive:true,capture:true});
    return ()=>{for(const name of ['pointerdown','keydown','wheel'])host.removeEventListener(name,intent,true);};
  });
  $effect(()=>{
    const position=restoration,node=scroller,settled=!busy,visible=items;
    if(!position||!node||!settled||!visible?.length||position===restored)return;
    void tick().then(async()=>{
      if(destroyed||scroller!==node||get().restoration!==position||get().busy||restorationCancelled)return;
      if(!restoreShelfPosition(node,'grid',position,true))return;
      restored=position;
      restoredWidth=node.clientWidth;
      // Focusing a card mounts its lazy controls; resolve its original control
      // once more after that render, while preserving any intervening user intent.
      await tick();
      if(!destroyed&&scroller===node&&get().restoration===position&&!restorationCancelled)
        restoreShelfPosition(node,'grid',position,true);
    });
  });
  $effect(() => {
    const key = resetKey, node = scroller;
    if (!node || node === resetScroller && key === previousResetKey) return;
    if(node===resetScroller&&get().layout==='grid')shelfScrollOwner(node).scrollTop=0;
    if (node !== resetScroller) anchoredWidth = 0;
    resetScroller = node; previousResetKey = key; positionedId = undefined;
    node.scrollLeft = 0; lastScrollLeft = 0;
  });
  $effect(()=>{
    const node=scroller,mode=layout;
    if(!node||mode!=='grid')return;
    const owner=shelfScrollOwner(node),target=owner===document.scrollingElement?window:owner;
    let top=owner.scrollTop;
    const changed=()=>{startRequested||=owner.scrollTop<top;top=owner.scrollTop;schedule();};
    target.addEventListener('scroll',changed,{passive:true});
    return ()=>target.removeEventListener('scroll',changed);
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
    reachedEnd, scroll, wheel, loadPrevious:prepend,
  };
}
