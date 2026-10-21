import { onMount, untrack, tick } from 'svelte';
import { page } from '$app/state';
import { usePlayback } from '#lib/playback/context.svelte.js';
import { noCrop, videoFitStyle } from '#lib/playback/crop.js';
import { heroPlaybackVisible } from '#lib/playback/visibility.js';
/** Each hero owns its video element, artwork-time buffering, crop fitting and cleanup. */
export function createHeroPlayback(get:()=>{id?:string;active:boolean;size:{width:number;height:number}}) {
  const { heroPlayer, player, preview } = usePlayback();

  let video = $state<HTMLVideoElement>();
  let foreground = $state(true);
  let frame = $state({ width: 0, height: 0 });
  const crop = $derived(heroPlayer.crop ?? noCrop);
  const permitted = $derived(page.data.capabilities?.playback !== false && page.data.capabilities?.screen !== false);
  const owner=$derived(get());
  const claimed=$derived(owner.active&&!!owner.id&&heroPlayer.id===owner.id);
  const visible = $derived(claimed && permitted && heroPlaybackVisible(heroPlayer.visible,player));
  const videoStyle = $derived(videoFitStyle(frame.width, frame.height,
    owner.size.width,owner.size.height,crop,true));

  function failed() {
    if(!claimed)return;
    heroPlayer.outcome = 'failed';
    heroPlayer.playing = false;
    heroPlayer.ready = false;
    heroPlayer.paused = true;
  }
  $effect(() => {
    if (preview || !permitted || !claimed) return;
    const url = heroPlayer.url, id = heroPlayer.id, element = video;
    heroPlayer.generation;
    if (!element || !url || !id) return;
    frame = { width: 0, height: 0 };
    heroPlayer.ready = false;
    element.src = url;
    return () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  });
  // Metadata and server crop styles must reach the DOM before playback is permitted.
  $effect(()=>{
    if(preview||!permitted||!claimed||!foreground||heroPlayer.outcome!=='idle'||heroPlayer.ready||!videoStyle)return;
    let cancelled=false;
    void tick().then(()=>{if(!cancelled)heroPlayer.ready=true;});
    return()=>{cancelled=true;};
  });
  $effect(() => {
    if (preview) return;
    const element = video, url = heroPlayer.url;
    heroPlayer.generation;
    const shouldPlay = visible && foreground && !heroPlayer.paused && heroPlayer.ready;
    if (!element) return;
    let cancelled = false;
    if (!url || !shouldPlay) element.pause();
    else untrack(() => void element.play().catch(() => { if (!cancelled) failed(); }));
    return () => { cancelled = true; };
  });
  $effect(() => {
    if (preview) return; if (video) video.muted = heroPlayer.muted; });
  onMount(() => {
    const update = () => (foreground = !document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  });
  return {
    get video() { return video; }, set video(value) { video = value; },
    get visible() { return visible; },
    get videoStyle() { return videoStyle; },
    loadedMetadata: () => { if (video) frame = { width: video.videoWidth, height: video.videoHeight }; },
    playing: () => {if(claimed)heroPlayer.playing=true;},
    paused: () => {if(claimed)heroPlayer.playing=false;},
    ended: () => {if(!claimed)return;heroPlayer.playing=false;heroPlayer.paused=true;heroPlayer.outcome='ended';},
    failed,
  };
}
