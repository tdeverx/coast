<script lang="ts">
  import type { Snippet } from 'svelte';

  import { setArtworkSample } from './artwork-context';
  setArtworkSample(sample);

  const panDirections = [[4, 2], [-4, 2], [0, -3], [4, 0], [-4, -2], [0, 3], [4, -2], [-4, 0]];
  type Frame = { id: number; url: string; x: number; y: number; startedAt: number };

  let { artwork, children }: { artwork: string[]; children: Snippet<[Snippet]> } = $props();
  // Route loads can deliver a fresh array containing the same artwork. Keep its animation clock.
  const playlist = $derived(artwork.join('\n'));
  let frames = $state<Frame[]>([]);
  let frameId = 0;

  function syncArtwork(node: HTMLImageElement, startedAt: number) {
    for (const animation of node.getAnimations()) animation.startTime = startedAt;
  }

  function finishFade(event: AnimationEvent) {
    const front = frames[1];
    if (front && event.target instanceof HTMLImageElement && event.target.dataset.frame === String(front.id)) {
      frames = [front];
    }
  }

  $effect(() => {
    const queue = (playlist ? playlist.split('\n') : []).map((url, index) => {
      const [x, y] = panDirections[index % panDirections.length];
      return { url, x, y };
    });
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let current: Frame | undefined;
    let timer: number | undefined;
    let loading = false;
    let stopped = false;
    frames = [];

    function schedule() {
      window.clearTimeout(timer);
      if (stopped || document.hidden || loading || !queue.length) return;
      if (!current) void advance();
      else if (!reducedMotion.matches && queue.length > 1) timer = window.setTimeout(advance, 12_000);
    }

    async function advance() {
      if (stopped || document.hidden) return;
      loading = true;
      try {
        while (queue.length) {
          const next = queue.shift()!;
          if (next.url === current?.url) {
            queue.push(next);
            break;
          }
          const image = new Image();
          image.referrerPolicy = 'no-referrer';
          image.src = next.url;
          try { await image.decode(); }
          catch { if (stopped || document.hidden) return; continue; }
          if (stopped) return;
          if (document.hidden || (current && reducedMotion.matches)) {
            queue.unshift(next);
            return;
          }
          const frame = { ...next, id: ++frameId, startedAt: Number(document.timeline.currentTime ?? performance.now()) };
          frames = current ? [current, frame] : [frame];
          current = frame;
          queue.push(next);
          break;
        }
      } finally {
        loading = false;
        schedule();
      }
    }

    function motionChanged() {
      if (reducedMotion.matches && current) frames = [current];
      schedule();
    }

    schedule();
    document.addEventListener('visibilitychange',schedule);
    reducedMotion.addEventListener('change',motionChanged);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange',schedule);
      reducedMotion.removeEventListener('change',motionChanged);
    };
  });
</script>

{#snippet artworkFrames()}
  <div class="frames">
    {#each frames as frame (frame.id)}
      <img data-frame={frame.id} src={frame.url} alt="" referrerpolicy="no-referrer" style:--pan-x={`${frame.x}%`} style:--pan-y={`${frame.y}%`} use:syncArtwork={frame.startedAt} />
    {/each}
  </div>
{/snippet}

{#snippet sample()}
  <div class="artwork-sample" aria-hidden="true">{@render artworkFrames()}</div>
{/snippet}

<div class="backdrop" aria-hidden="true" onanimationend={finishFade}>
  {@render artworkFrames()}
</div>
{@render children(sample)}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .frames {
    position: absolute;
    inset: -32px;
    filter: blur(6px);
  }
  .frames:empty {
    display: none;
  }
  .backdrop:has(img)::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      ellipse 60% 75% at top center,
      color-mix(in srgb, var(--canvas) 40%, transparent),
      color-mix(in srgb, var(--canvas) 64%, transparent) 50%,
      var(--canvas)
    );
  }
  .artwork-sample {
    position: absolute;
    inset: 0;
    pointer-events: none;
    clip-path: inset(2px round var(--artwork-radius, 999px));
  }
  /* Each clip follows its glass surface. The artwork always uses viewport coordinates. */
  .artwork-sample .frames {
    position: fixed;
  }
  .artwork-sample .frames:has(img)::after {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--canvas) 58%, transparent);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: backdrop-pan 16s ease-in-out infinite alternate, backdrop-fade 2800ms linear both;
  }
  @keyframes backdrop-pan {
    from { transform: translate(calc(-1 * var(--pan-x)), calc(-1 * var(--pan-y))) scale(1.12); }
    to { transform: translate(var(--pan-x), var(--pan-y)) scale(1.16); }
  }
  @keyframes backdrop-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    img { animation: none; }
  }
</style>
