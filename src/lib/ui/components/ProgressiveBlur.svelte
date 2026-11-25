<script lang="ts">
  import { progressiveBlurBands, progressiveBlurSteps, progressiveTintSteps, progressiveTintStops } from '../materials/progressive-blur.js';

  /**
   * Decorative overlay for a positioned parent. Render after the backdrop and
   * before any positioned foreground content that should stay sharp.
   */
  let {
    edge = 'bottom', size = '45%', radius = 28, steps = progressiveBlurSteps.default,
    tint, tintOpacity = 0.75, tintSteps = progressiveTintSteps.default,
  }: {
    /** Edge at which the blur and tint are strongest. */
    edge?: 'top' | 'right' | 'bottom' | 'left';
    /** CSS length or percentage measured inward from the selected edge. */
    size?: string;
    /** Maximum blur radius in pixels. Set to 0 for a colour-only fade. */
    radius?: number;
    /** Number of overlapping blur layers, from 1 to 24. */
    steps?: number;
    /** CSS colour or gradient. */
    tint?: string;
    /** Peak tint opacity, from 0 to 1. */
    tintOpacity?: number;
    /** Number of tint opacity stops, including clear and peak, from 2 to 24. */
    tintSteps?: number;
  } = $props();

  const bands = $derived(progressiveBlurBands(steps));
  const tintStops = $derived(progressiveTintStops(tintSteps));
</script>

<div class="progressive-blur" data-edge={edge} style:--size={size} aria-hidden="true">
  {#if radius > 0 && Number.isFinite(radius)}
    {#each bands as { start, end, strength }}
      <div
        class="blur-band"
        style:--radius={`${radius * strength}px`}
        style:--start={`${start}%`}
        style:--end={`${end}%`}
      ></div>
    {/each}
  {/if}
  {#if tint && tintOpacity > 0}
    <div class="tint" style:--tint={tint} style:--tint-stops={tintStops} style:opacity={tintOpacity}></div>
  {/if}
</div>

<style>
  .progressive-blur {
    position: absolute;
    z-index: 0;
    pointer-events: none;
  }
  .progressive-blur:is([data-edge='top'], [data-edge='bottom']) {
    left: 0;
    right: 0;
    height: var(--size);
    max-height: 100%;
  }
  .progressive-blur:is([data-edge='left'], [data-edge='right']) {
    top: 0;
    bottom: 0;
    width: var(--size);
    max-width: 100%;
  }
  .progressive-blur[data-edge='top'] { top: 0; --direction: to top; }
  .progressive-blur[data-edge='right'] { right: 0; --direction: to right; }
  .progressive-blur[data-edge='bottom'] { bottom: 0; --direction: to bottom; }
  .progressive-blur[data-edge='left'] { left: 0; --direction: to left; }

  .blur-band, .tint {
    position: absolute;
    inset: 0;
  }
  .blur-band {
    backdrop-filter: blur(var(--radius));
    --ramp: calc(var(--end) - var(--start));
    mask-image: linear-gradient(
      var(--direction),
      transparent var(--start),
      rgb(0 0 0 / 0.16) calc(var(--start) + var(--ramp) * 0.25),
      rgb(0 0 0 / 0.84) calc(var(--start) + var(--ramp) * 0.75),
      black var(--end)
    );
  }
  .tint {
    background: var(--tint);
    mask-image: linear-gradient(var(--direction), var(--tint-stops));
  }
  @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
    .blur-band { display: none; }
  }
</style>
