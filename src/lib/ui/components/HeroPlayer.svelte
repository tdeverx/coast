<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { heroPlayer, player } from '$lib/playback/client.svelte';
  import { noCrop, videoFitStyle, type FrameCrop } from '$lib/playback/crop';
  import { observeVideoCrop } from '$lib/playback/observe-crop';

  let video: HTMLVideoElement;
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
</script>

<div class="hero-player" class:visible style={surfaceStyle} aria-hidden="true">
  <video bind:this={video} data-player="hero" muted={heroPlayer.muted} playsinline preload="metadata" tabindex="-1"
    class:positioned={!!videoStyle} style={videoStyle}
    onloadedmetadata={() => (frame = { width: video.videoWidth, height: video.videoHeight })}
    onplaying={() => (heroPlayer.playing = true)}
    onpause={() => (heroPlayer.playing = false)}
    onended={() => { heroPlayer.playing = false; heroPlayer.paused = true; }}
    onerror={failed}
  ></video>
</div>

<style>
  .hero-player { position: fixed; z-index: 1; overflow: hidden; pointer-events: none; visibility: hidden; }
  .hero-player.visible { visibility: visible; }
  video { position: absolute; width: 100%; height: 100%; object-fit: cover; }
  video.positioned { max-width: none; object-fit: fill; }
</style>
