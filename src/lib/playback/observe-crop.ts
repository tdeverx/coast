import { createCropTracker, measureBlackBars, type FrameCrop } from './crop';

/** Each persistent video owns its own crop history, sampler, and readiness. */
export function observeVideoCrop(video: HTMLVideoElement, options: {
  enabled: () => boolean;
  onCrop: (crop: FrameCrop) => void;
  onReady?: () => void;
}) {
  const observe = createCropTracker();
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let cancelled = false, ready = false, lastTime = -1;
  let timer: ReturnType<typeof setTimeout>;
  const sample = () => {
    if (cancelled) return;
    if (document.hidden || video.paused || video.readyState < 2
      || video.currentTime === lastTime || !options.enabled()) {
      timer = setTimeout(sample, 1000);
      return;
    }
    lastTime = video.currentTime;
    try {
      if (!context) { options.onReady?.(); return; }
      context.drawImage(video, 0, 0, 160, 90);
      const pixels = context.getImageData(0, 0, 160, 90);
      const result = observe(measureBlackBars(pixels.data, 160, 90));
      if (result.crop) options.onCrop(result.crop);
      if (!ready && result.ready) { ready = true; options.onReady?.(); }
      if (result.complete) return;
    } catch {
      options.onReady?.();
      return;
    }
    timer = setTimeout(sample, ready ? 1000 : 300);
  };
  timer = setTimeout(sample, 300);
  return () => { cancelled = true; clearTimeout(timer); };
}
