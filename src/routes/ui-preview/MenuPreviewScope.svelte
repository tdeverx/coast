<script lang="ts">
  import type { Snippet } from 'svelte';
  import { provideMenuPreview, type MenuConditions } from '#lib/ui/controls/menu-preview.js';

  let { conditions, inline, wrappers = [], children }: {
    conditions: MenuConditions; inline: string; wrappers?: readonly string[]; children: Snippet;
  } = $props();
  let target = $state<HTMLDivElement>();
  provideMenuPreview({ get conditions() { return conditions; }, get inline() { return inline; },
    get wrappers() { return wrappers; }, target: () => target });
</script>
<div class="menu-target" bind:this={target}></div>
<div class="menu-fixture">{@render children()}</div>
<style>
  .menu-target { display: grid; justify-content: center; min-width: 0; }
  .menu-fixture { position: absolute; visibility: hidden; pointer-events: none; height: 0; overflow: visible; }
  .menu-fixture :global(dialog[open]) { visibility: visible; pointer-events: auto; }
</style>
