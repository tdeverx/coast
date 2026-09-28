<script lang="ts">
  import Icon from './Icon.svelte';
  import { contextGesture, type MenuPoint } from '$lib/ui/context-gesture';
  let {
    title,
    href,
    oncontext,
  }: { title: string; href?: string; oncontext?: (point: MenuPoint) => void } = $props();
  function preview(node: HTMLElement) {
    if (oncontext) return contextGesture(node, oncontext);
  }
</script>

<h2 use:preview>
  {#if href}<a {href} aria-label={`View all ${title}`}><span>{title}</span><Icon name="right" /></a>
  {:else}{title}{/if}
</h2>

<style>
  h2 {
    margin: 0;
    font-size: var(--row-title-size);
    font-weight: var(--row-title-weight);
    overflow-wrap: anywhere;
  }
  a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
  }
  a :global(svg) {
    width: 1em;
    height: 1em;
    flex: none;
    opacity: 0.6;
  }
  a:hover :global(svg),
  a:focus-visible :global(svg) {
    opacity: 1;
  }
</style>
