<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import { heroTitleIds } from '$lib/media/hero';
  import CollectionHero from './CollectionHero.svelte';

  let {
    children,
    hero = false,
    items = [],
    selection = '',
    busy = false,
    class: className = '',
  }: {
    children: Snippet;
    hero?: boolean;
    items?: MediaView[];
    selection?: string;
    busy?: boolean;
    class?: string;
  } = $props();

  const hasHero = $derived(hero && heroTitleIds(items).length > 0);
</script>

{#if hasHero}<CollectionHero {items} {selection} {busy} />{/if}
<div class={`content ${className}`} class:page={!hasHero} class:route-content={!hasHero}>
  {@render children()}
</div>
