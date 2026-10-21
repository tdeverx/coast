import { page } from '$app/state';
import {createHeroCycle,type HeroPhase} from './cycle';
import {reader} from '#lib/reading/client.svelte.js';
import { onMount, untrack } from 'svelte';
import { useClient } from '#lib/ui/client-context.js';
import { heroTitleIds, isHeroTitle } from '#lib/media/hero.js';
import type { MediaView, MediaHeroPresentation } from '#lib/ui/types.js';
import { playbackVisible } from '#lib/playback/visibility.js';
import { presentTrailer } from '#lib/playback/client.svelte.js';
import { usePlayback } from '#lib/playback/context.svelte.js';
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
    fadeTimer: ReturnType<typeof setTimeout>,
    gestureDistance = 0,
    gestureTimer: ReturnType<typeof setTimeout>;
  let switchController:AbortController|null=null;
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
  const activeId=$derived(active?.id);
  $effect(()=>{
    activeId;
    return()=>{switchController?.abort();switchController=null;clearTimeout(fadeTimer);fading=false;};
  });
  const presentation = $derived(parents.find((parent) => parent.kind === 'show') ?? active);
  const titleLogo = $derived(active?.logo ?? presentation?.logo);
  $effect(()=>{active?.backdrop;backdropFailed=false;});
  $effect(()=>{active?.poster;posterFailed=false;});
  $effect(()=>{titleLogo;logoFailed=false;});
  const hasTrailer = $derived(heroPlayer.id === active?.id && !!heroPlayer.url);
  const showingTrailer = $derived(
    hasTrailer && heroPlayer.playing && heroPlayer.ready && heroPlayer.visible
  );
  let mouseIdle = $state(false);
  let controlFocused = $state(false),resumeFocused=$state(false);
  let idleTimer: ReturnType<typeof setTimeout>;
  const chromeDimmed = $derived(showingTrailer && mouseIdle && !controlFocused);
  let size=$state({width:0,height:0});
  function noteActivity(event?: PointerEvent) {
    if (event && event.pointerType !== 'mouse') return;
    clearTimeout(idleTimer);
    mouseIdle = false;
    idleTimer = setTimeout(() => (mouseIdle = true), 2200);
  }
  async function step(by: number) {
    if (fading || items.length < 2) return;
    switchController?.abort();
    const controller=new AbortController();switchController=controller;
    const nextIndex=(current+by+items.length)%items.length,target=items[nextIndex];
    // Keep the current item intact until the requested artwork and logo are decoded.
    await Promise.all([target.backdrop??target.poster,target.logo].filter((src):src is string=>!!src).map(async src=>{
      const image=new Image();
      const cancel=()=>image.removeAttribute('src');
      controller.signal.addEventListener('abort',cancel,{once:true});
      image.src=src;
      try{await image.decode();}catch{/* The normal artwork fallback handles unavailable images. */}
      finally{controller.signal.removeEventListener('abort',cancel);}
    }));
    if(controller.signal.aborted)return;
    if(heroPlayer.id===active?.id)heroPlayer.visible=false;
    fading = true;
    fadeTimer=setTimeout(()=>{
      current = nextIndex;
      fading = false;
    },reducedMotion?0:160);
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
  let phase=$state<HeroPhase>('artwork'),attached=$state(false);
  let paused=$state(false),motionRequested=$state(false);
  let prepare=$state.raw<(()=>void)|null>(null);
  let cycle=$state.raw<ReturnType<typeof createHeroCycle>|null>(null);
  let intersecting=$state(false),foreground=$state(true),reducedMotion=$state(false);
  const motionSuspended=$derived(reducedMotion&&!motionRequested);
  const controlPaused=$derived(paused||motionSuspended||phase==='complete');
  const obscured=$derived(playbackVisible(player)||reader.visible||!!page.state.mediaDetailHref||page.data.capabilities?.playback===false||page.data.capabilities?.screen===false);
  $effect(()=>{
    const id=activeId,element=host;
    if(preview||!id||!element)return;
    const title=untrack(()=>active)!;
    const controller=new AbortController();
    let url=screenItem(title)?title.trailer:null;
    let crop:import('#lib/playback/crop.js').FrameCrop|null=null,pending=false;
    phase='artwork';attached=false;
    intersecting=false;
    const owned=createHeroCycle({
      phase:next=>{phase=next;if(next!=='trailer'&&heroPlayer.id===id)heroPlayer.visible=false;},
      trailer:()=>!controller.signal.aborted&&!!(url||pending),
      next:()=>{if(!controller.signal.aborted)step(1);},
    });
    cycle=owned;
    const observer=new IntersectionObserver(entries=>{
      const entry=entries[0];intersecting=entry.isIntersecting&&entry.intersectionRatio>=0.3;
    },{threshold:0.3});
    observer.observe(element);
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const visibility=()=>{foreground=!document.hidden;};
    const preference=()=>{reducedMotion=motion.matches;motionRequested=false;};
    visibility();preference();
    document.addEventListener('visibilitychange',visibility);
    motion.addEventListener('change',preference);
    // Discover crop data and buffer the active trailer during artwork, without starting playback.
    let requested=false;
    const attach=()=>{
      if(!attached&&url&&(phase==='artwork'||phase==='trailer')&&intersecting&&foreground&&!obscured&&!motionSuspended&&!controller.signal.aborted){
        presentTrailer(id,url,crop);
        heroPlayer.visible=phase==='trailer';heroPlayer.paused=paused;attached=true;
      }
    };
    prepare=()=>{
      attach();
      if(requested||url||!screenItem(title)||!title.available)return;
      requested=true;pending=true;
      void api<{url:string|null;crop:import('#lib/playback/crop.js').FrameCrop|null}>(`media/${id}/trailer`,undefined,'GET',{signal:controller.signal})
        .then(result=>{if(controller.signal.aborted)return;url=result.url;crop=result.crop??null;pending=false;
          if(url)attach();else if(phase==='trailer')owned.finishTrailer();})
        .catch(()=>{pending=false;if(!controller.signal.aborted&&phase==='trailer')owned.finishTrailer();});
    };
    return()=>{
      controller.abort();owned.dispose();prepare=null;
      if(untrack(()=>cycle)===owned)cycle=null;
      observer.disconnect();document.removeEventListener('visibilitychange',visibility);
      motion.removeEventListener('change',preference);
      if(heroPlayer.id===id)heroPlayer.visible=false;
    };
  });
  $effect(()=>{
    const enabled=intersecting&&foreground&&!obscured&&!motionSuspended;
    const owned=cycle;
    if(enabled&&prepare&&(phase==='artwork'||phase==='trailer'))untrack(prepare);
    owned?.running(enabled&&(!controlFocused||resumeFocused)&&!paused);
    if(attached&&heroPlayer.id===active?.id){
      if(phase==='trailer'&&heroPlayer.outcome==='idle')heroPlayer.paused=paused;
      heroPlayer.visible=enabled&&phase==='trailer';
    }
  });
  $effect(()=>{
    if(!attached||heroPlayer.id!==active?.id||phase!=='trailer')return;
    if(heroPlayer.outcome==='ended'||heroPlayer.outcome==='failed')cycle?.finishTrailer();
    else if(heroPlayer.playing)cycle?.playing();
  });
  function togglePlayback(){
    if(phase==='complete'){paused=false;motionRequested=true;cycle?.restart();}
    else if(motionSuspended){motionRequested=true;paused=false;}
    else paused=!paused;
    // Explicit Play must resume even while its button retains focus.
    resumeFocused=!paused;
  }
  $effect(() => {
    if (!host) return;
    const element = host;
    element.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('pointermove', noteActivity);
    noteActivity();
    const shell = element.closest<HTMLElement>('.page-shell');
    const resize = new ResizeObserver(entries => {
      const box=entries[0]?.borderBoxSize?.[0];
      const next=box?{width:box.inlineSize,height:box.blockSize}:element.getBoundingClientRect();
      if(size.width!==next.width||size.height!==next.height)size={width:next.width,height:next.height};
      shell?.style.setProperty('--active-hero-height', `${next.height}px`);
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
    get size() {return size;},
    get presentation() { return presentation; },
    get titleLogo() { return titleLogo; },
    get paused() {return controlPaused;},
    get showingTrailer() { return showingTrailer; },
    get chromeDimmed() { return chromeDimmed; },
    get phase() {return phase;},
    get attached() {return attached;},
    get fading() { return fading; },
    get transitionDuration() {return reducedMotion?0:450;},
    get host() { return host; }, set host(value) { host = value; },
    get backdropFailed() { return backdropFailed; }, set backdropFailed(value) { backdropFailed = value; },
    get posterFailed() { return posterFailed; }, set posterFailed(value) { posterFailed = value; },
    get logoFailed() { return logoFailed; }, set logoFailed(value) { logoFailed = value; },
    get controlFocused() { return controlFocused; }, set controlFocused(value) { controlFocused = value;resumeFocused=false; },
    noteActivity, step, togglePlayback,
  };
}
