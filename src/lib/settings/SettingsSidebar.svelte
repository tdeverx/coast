<script lang="ts">
  import type { Snippet } from 'svelte';
  import { quadOut, sineInOut } from 'svelte/easing';
  import ProgressiveBlur from '#lib/ui/components/ProgressiveBlur.svelte';

  let { open, onclose, onclosed, children }: {
    open: boolean; onclose: () => void; onclosed?: () => void; children: Snippet;
  } = $props();
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!open || !dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  });

  function reducedMotion() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function fadeBackdrop(_node: Element) {
    return {
      duration: reducedMotion() ? 0 : 200,
      easing: quadOut,
      css: (progress: number, remaining: number) =>
        `translate: ${24 * remaining}px 0; --sidebar-blur-visibility: ${progress}`,
    };
  }

  function settleSidebar(progress: number) {
    const remaining = progress * (0.5 + 0.5 * progress) - 1;
    return 1 + remaining * remaining * (1.45 * remaining + 0.45);
  }

  function slideSidebar(_node: Element, { opening = false } = {}) {
    const reduce = reducedMotion();
    return {
      delay: opening && !reduce ? 80 : 0,
      duration: reduce ? 0 : opening ? 340 : 210,
      easing: opening ? settleSidebar : sineInOut,
      css: (_progress: number, remaining: number) => `translate: ${100 * remaining}% 0`,
    };
  }
</script>

{#if open}
  <div class="sidebar-effect" aria-hidden="true" transition:fadeBackdrop>
    <ProgressiveBlur edge="right" size="100%" radius={5} steps={4}
      tint="rgb(0 0 0 / var(--sidebar-blur-visibility, 1))" tintOpacity={0.5} tintSteps={4} />
  </div>
{/if}
<dialog class="sidebar-dialog" aria-label="Settings" bind:this={dialog}
  oncancel={event => { event.preventDefault(); onclose(); }}>
  {#if open}
    <button type="button" class="dismiss-area" aria-label="Dismiss Settings" tabindex="-1" onclick={onclose}></button>
    <div class="sidebar-content" in:slideSidebar={{ opening: true }} out:slideSidebar
      onoutroend={() => {
        if (open) return;
        dialog?.close();
        onclosed?.();
      }}>
      {@render children()}
    </div>
  {/if}
</dialog>

<style>
  .sidebar-effect {
    position: fixed;
    inset: 0;
    z-index: 79;
    overflow: clip;
    pointer-events: none;
  }
  .sidebar-effect :global(.blur-band) { opacity: var(--sidebar-blur-visibility, 1); }
  .sidebar-dialog {
    position: fixed;
    inset: var(--app-header-height, 64px) 0 0;
    max-inline-size: none;
    max-block-size: none;
    inline-size: 100%;
    block-size: calc(100dvh - var(--app-header-height, 64px));
    margin: 0;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ink);
    overflow: clip;
  }
  .sidebar-dialog::backdrop { background: transparent; }
  .sidebar-dialog[open] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) min(100%, calc(var(--auth-width) + 2 * var(--gutter)));
  }
  .dismiss-area {
    border: 0;
    padding: 0;
    background: transparent;
    cursor: default;
  }
  .dismiss-area:focus { outline: none; }
  .sidebar-content {
    position: relative;
    display: grid;
    justify-items: center;
    min-block-size: 0;
    min-inline-size: 0;
    padding-inline: max(var(--auth-gap), env(safe-area-inset-left)) max(var(--auth-gap), env(safe-area-inset-right));
    padding-block-end: max(var(--auth-gap), env(safe-area-inset-bottom));
  }
  @media (max-width: 767px) {
    .sidebar-content { padding-block-end: calc(54px + var(--auth-gap) + env(safe-area-inset-bottom)); }
  }
  @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
    .sidebar-effect { display: none; }
    .sidebar-content { background: var(--canvas); }
  }
</style>
