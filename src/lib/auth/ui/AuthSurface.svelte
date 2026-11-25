<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import { getArtworkSample } from './artwork-context';
  let { children, anchor = false, invite = false, expanded, resizable = false, sideActions = false }: {
    children: Snippet; anchor?: boolean; invite?: boolean; expanded?: boolean; resizable?: boolean; sideActions?: boolean;
  } = $props();
  const sample = getArtworkSample();
  function fadeFrame(node: Element) {
    return fade(node, { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240 });
  }
</script>

{#if anchor}
  <div class="auth-anchor">{@render sample?.()}{@render children()}</div>
{:else if expanded !== undefined}
  <div class="menu-surface credential-fields expandable" class:expanded>
    {#if expanded}
      <div class="expansion-glass" transition:fadeFrame aria-hidden="true">
        {@render sample?.()}
        <div class="glass" use:liquidGlass={{variant: 'clear'}}></div>
      </div>
    {/if}
    <div class="menu-content">{@render children()}</div>
  </div>
{:else}
  <div class="credential-group" class:resizable>
    {@render sample?.()}
    <div class="menu-surface glass credential-fields" class:invite class:side-actions={sideActions}
      use:liquidGlass={{ variant: 'clear', renderer: resizable ? 'css' : 'auto' }}>
      {#if resizable}
        <!-- Dropdowns own their scroll region and keep the same renderer while resizing. -->
        {@render children()}
      {:else}
        <div class="menu-content">{@render children()}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .auth-anchor { position: relative; width: var(--auth-anchor-width, fit-content); max-width: 100%; min-width: 0; }
  .credential-group {
    position: relative;
    --artwork-radius: var(--glass-surface-radius);
  }
  .menu-surface.credential-fields {
    position: relative;
    z-index: auto;
    width: 100%;
    min-width: 0;
    max-width: none;
    max-height: none;
  }
  .resizable, .resizable > .credential-fields { block-size: 100%; }
  .resizable > .credential-fields { grid-template-rows: minmax(0, 1fr); }
  .expandable { padding-block: 0; }
  .expandable > .menu-content { position: relative; padding-inline: 0; }
  .expandable.expanded { padding-block: var(--menu-frame-inset); }
  .expandable.expanded > .menu-content { padding-inline: var(--menu-frame-inset); }
  .expansion-glass {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    --artwork-radius: var(--glass-surface-radius);
    pointer-events: none;
  }
  .expansion-glass > .glass { block-size: 100%; border-radius: inherit; }
  @media (prefers-reduced-motion: no-preference) {
    .expandable { transition: padding-block var(--motion) var(--ease); }
    .expandable > .menu-content { transition: padding-inline var(--motion) var(--ease); }
  }
  .credential-fields:is(.side-actions, :has(:global(.auth-side-action))),
  .credential-fields:is(.side-actions, :has(:global(.auth-side-action))) > .menu-content { overflow:visible; }
  .credential-fields :global(.auth-side-action) { margin-inline-start:var(--menu-frame-inset); }
  .credential-fields.invite {
    background-image:
      linear-gradient(110deg, transparent,
        color-mix(in srgb, var(--invite-gold) 8%, transparent) 25%,
        color-mix(in srgb, var(--invite-gleam) 23%, transparent) 44% 56%,
        color-mix(in srgb, var(--invite-gold) 8%, transparent) 75%, transparent),
      linear-gradient(115deg, color-mix(in srgb, var(--invite-amber) 60%, transparent),
        color-mix(in srgb, var(--invite-gold) 43%, transparent) 58%,
        color-mix(in srgb, var(--invite-amber) 34%, transparent));
    background-size: 200% 100%, 100% 100%;
    background-repeat: no-repeat;
    background-position: 200% center, center;
  }
  @media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
    .credential-fields.invite { animation: invite-shimmer 6.5s var(--ease) infinite; }
    @keyframes invite-shimmer {
      /* Oversized backgrounds move right as their position percentage decreases. */
      0%, 5% { background-position: 200% center, center; }
      96%, 100% { background-position: -100% center, center; }
    }
  }
</style>
