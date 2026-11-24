<script lang="ts">
  import { artworkShimmerColour } from '../artwork-colour';
  import Icon from '../components/Icon.svelte';
  import { liquidGlass } from '../materials/glass';
  import { observeVisibility } from '../visibility';

  let { kind, value, title, artwork, onclick, popup }: {
    kind: 'rating' | 'match'; value: number; title: string; artwork?: string;
    onclick?: (event: MouseEvent) => void; popup?: 'menu' | 'dialog';
  } = $props();
  const filterId = $props.id();
  const strip = 'data:image/svg+xml,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 16">
      <defs><linearGradient id="sweep" x1="0%" y1="75%" x2="100%" y2="25%">
        <stop offset="0" stop-opacity="0"/><stop offset=".33" stop-opacity=".6"/>
        <stop offset=".52"/><stop offset=".72" stop-opacity=".85"/><stop offset="1" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="140" height="16" fill="url(#sweep)"/>
    </svg>`);
  const shimmer = $derived(kind === 'match' && value >= 80);
  let visible = $state(false);
  const animateShimmer = $derived(shimmer && visible);
  function watchShimmer(node: HTMLElement) {
    $effect(() => {
      if (!shimmer) return;
      const motion = matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
      let near = false;
      const update = () => { visible = near && !motion.matches; };
      const stop = observeVisibility(node, value => { near = value; update(); });
      motion.addEventListener('change', update);
      return () => { stop(); motion.removeEventListener('change', update); visible = false; };
    });
  }
  const text = $derived(kind === 'rating' ? `${value}/5` : shimmer ? 'For You' : `${value}%`);
  const label = $derived(kind === 'rating' ? `Rating for ${title}, ${value} out of 5` : `Taste match for ${title}, ${value}%`);
  const colourSources = $derived.by(() => {
    if (!animateShimmer || !artwork) return [];
    if (!artwork.startsWith('https://image.tmdb.org/')) return [artwork];
    // Give the CORS-enabled sampler its own cache key alongside the displayed poster.
    const url = new URL(artwork);
    url.searchParams.set('coast-colour', '1');
    return [url.href];
  });
</script>

<svelte:element this={onclick ? 'button' : 'span'} type={onclick ? 'button' : undefined}
  class="card-metric glass" class:match-metric={kind === 'match'} class:shimmer={animateShimmer}
  use:liquidGlass={{ variant: 'clear' }} use:watchShimmer use:artworkShimmerColour={colourSources}
  style:--metric-shimmer={`url(#${filterId})`} role={onclick ? undefined : 'img'}
  aria-label={label} aria-haspopup={onclick ? popup : undefined} {onclick}>
  {#if animateShimmer}
    <svg class="shimmer-definition" width="0" height="0" aria-hidden="true">
      <defs>
        <filter id={filterId} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
          <feImage href={strip} x="-1.4" y="0" width="1.4" height="1" preserveAspectRatio="none" result="shimmer">
            <animate attributeName="x" values="-1.4;-1.4;1;1" keyTimes="0;0.12;0.72;1"
              calcMode="spline" keySplines="0 0 1 1;0.25 0.1 0.25 1;0 0 1 1" dur="6s" repeatCount="indefinite" />
          </feImage>
          <feFlood class="shimmer-colour" result="tint" />
          <feComposite in="tint" in2="shimmer" operator="in" result="band" />
          <feComposite in="band" in2="SourceGraphic" operator="in" result="shimmer-ink" />
          <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="shimmer-ink" /></feMerge>
        </filter>
      </defs>
    </svg>
  {/if}
  <span class="metric-content">
    <span class="metric-icon"><Icon name={kind === 'rating' ? 'star' : 'sparkle'} size={kind === 'rating' ? 14 : 19.3} filled /></span>
    <span>{text}</span>
  </span>
</svelte:element>

<style>
  .shimmer-definition { position: absolute; pointer-events: none; }
  .shimmer-colour { flood-color: color-mix(in oklab, var(--artwork-shimmer-colour, var(--rating)) 75%, var(--white)); }
  .card-metric {
    --metric-end-adjustment: 0.6px;
    display: inline-flex;
    align-items: center;
    padding: var(--metric-spacing);
    padding-inline-end: calc(1.5 * (var(--metric-spacing) + var(--metric-end-adjustment)));
    border-radius: var(--artwork-badge-radius);
    color: var(--white);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-card-metric);
    white-space: nowrap;
    transform-origin: center;
    scale: var(--card-glass-scale, 1);
  }
  .match-metric { --metric-end-adjustment: 0.4px; }
  .metric-content { display: inline-flex; align-items: center; gap: var(--metric-spacing); }
  @media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
    .shimmer .metric-content { filter: var(--metric-shimmer); }
  }
  .metric-icon { display: flex; flex: none; width: 14px; height: 14px; align-items: center; justify-content: center; }
  .metric-icon :global(svg) { flex: none; }
</style>
