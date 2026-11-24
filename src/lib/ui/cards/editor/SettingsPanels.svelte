<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cubicInOut } from 'svelte/easing';

  let { section, direction, children }: {
    section: string;
    direction: -1 | 1;
    children: Snippet<[string]>;
  } = $props();

  function push(_node: HTMLElement, entering: boolean) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
    const side = entering ? direction : -direction;
    return {
      duration: 300, easing: cubicInOut,
      // As on onboarding, left keeps the fixed artwork in the glass anchored to the viewport.
      css: (t: number, u: number) => `left:${side * u * 100}%;opacity:${t};`,
    };
  }
</script>

<div class="section-panels">
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
  .section-panels { position:relative; min-inline-size:0; min-block-size:0; overflow-x:clip; }
  .section-panels:has(> :global(.section-panel[aria-hidden='true'])) {
    --section-edge-fade:clamp(12px, 4vw, 28px);
    mask-image:linear-gradient(to right, transparent, black var(--section-edge-fade),
      black calc(100% - var(--section-edge-fade)), transparent);
  }
  .section-panel { position:absolute; inset:0 auto 0 0; inline-size:100%; display:grid; }
</style>
