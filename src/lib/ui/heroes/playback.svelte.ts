import { onMount, untrack } from 'svelte';
import { heroPlayer, player } from '$lib/playback/client.svelte';
import { noCrop, videoFitStyle, type FrameCrop } from '$lib/playback/crop';
import { observeVideoCrop } from '$lib/playback/observe-crop';
/** A single root-owned video surface survives hero and route changes. */
export function createHeroPlayback() {
  let video = $state<HTMLVideoElement>();
  let foreground = $state(true);
  let frame = $state({ width: 0, height: 0 });
  let crop = $state<FrameCrop>(noCrop);
  const visible = $derived(heroPlayer.visible && (!player.session || player.paused));
  const surfaceStyle = $derived(heroPlayer.rect
    ? `top:${heroPlayer.rect.top}px;left:${heroPlayer.rect.left}px;width:${heroPlayer.rect.width}px;height:${heroPlayer.rect.height}px;` : '');
  const videoStyle = $derived(videoFitStyle(frame.width, frame.height,
    heroPlayer.rect?.width ?? 0, heroPlayer.rect?.height ?? 0, crop, true));

  function failed() {
    heroPlayer.playing = false;
    heroPlayer.ready = false;
    heroPlayer.paused = true;
  }
  $effect(() => {
    const url = heroPlayer.url, id = heroPlayer.id, element = video;
    if (!element || !url || !id) return;
    crop = noCrop;
    frame = { width: 0, height: 0 };
    heroPlayer.ready = false;
    element.src = url;
    const stopCrop = observeVideoCrop(element, {
      enabled: () => visible,
      onCrop: (next) => (crop = next),
      onReady: () => (heroPlayer.ready = true),
    });
    return () => {
      stopCrop();
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  });
  $effect(() => {
    const element = video, url = heroPlayer.url;
    const shouldPlay = visible && foreground && !heroPlayer.paused;
    if (!element) return;
    let cancelled = false;
    if (!url || !shouldPlay) element.pause();
    else untrack(() => void element.play().catch(() => { if (!cancelled) failed(); }));
    return () => { cancelled = true; };
  });
  $effect(() => { if (video) video.muted = heroPlayer.muted; });
  onMount(() => {
    const update = () => (foreground = !document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  });
  return {
    get video() { return video; }, set video(value) { video = value; },
    get visible() { return visible; },
    get surfaceStyle() { return surfaceStyle; },
    get videoStyle() { return videoStyle; },
    loadedMetadata: () => { if (video) frame = { width: video.videoWidth, height: video.videoHeight }; },
    failed,
  };
}
