<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cubicInOut } from 'svelte/easing';

  let { section, direction, liveBackdrop = false, children }: {
    section: string;
    direction: -1 | 1;
    liveBackdrop?: boolean;
    children: Snippet<[string]>;
  } = $props();

  function push(_node: HTMLElement, entering: boolean) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
    const side = entering ? direction : -direction;
    return {
      duration: 300, easing: cubicInOut,
      // As on onboarding, left keeps the fixed artwork in the glass anchored to the viewport.
      css: (t: number, u: number) => `left:${side * u * 100}%;${liveBackdrop ? '' : `opacity:${t};`}`,
    };
  }
</script>

<div class="section-panels" class:live-backdrop={liveBackdrop}>
  {#each [section] as panel (panel)}
    <div class="section-panel" in:push={true} out:push={false}
      onoutrostart={event => {
        event.currentTarget.inert = true;
        event.currentTarget.setAttribute('aria-hidden', 'true');
      }}
      onintrostart={event => {
        event.currentTarget.inert = false;
        event.currentTarget.removeAttribute('aria-hidden');
      }}>
      {@render children(panel)}
    </div>
  {/each}
</div>

<style>
  .section-panels {
    position: relative;
    min-inline-size: 0;
    min-block-size: 0;
    overflow-x: clip;
    --section-edge-fade:clamp(12px, 4vw, 28px);
  }
  .section-panels:not(.live-backdrop):has(> :global(.section-panel[aria-hidden='true'])) {
    mask-image:linear-gradient(to right, transparent, black var(--section-edge-fade),
      black calc(100% - var(--section-edge-fade)), transparent);
  }
  /* Soften the edge above the moving panes without isolating their live backdrop. */
  @media (prefers-reduced-motion: no-preference) {
    .live-backdrop:has(> :global(.section-panel[aria-hidden='true']))::before,
    .live-backdrop:has(> :global(.section-panel[aria-hidden='true']))::after {
      content: '';
      position: absolute;
      inset-block: 0;
      inline-size: var(--section-edge-fade);
      z-index: 1;
      pointer-events: none;
      backdrop-filter: blur(4px);
    }
    .live-backdrop::before {
      left: 0;
      mask-image: linear-gradient(to right, black, transparent);
    }
    .live-backdrop::after {
      right: 0;
      mask-image: linear-gradient(to left, black, transparent);
    }
  }
  @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
    .live-backdrop::before, .live-backdrop::after { display: none; }
  }
  .section-panel { position:absolute; inset:0 auto 0 0; inline-size:100%; display:grid; }
</style>
