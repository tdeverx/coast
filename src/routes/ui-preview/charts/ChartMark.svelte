<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, index, selected, onselect, children }: { label: string; index: number; selected: number; onselect: (index: number) => void; children: Snippet } = $props();
</script>

<g role="button" tabindex={selected === index ? 0 : -1} aria-label={label} aria-pressed={selected === index}
  onpointerenter={() => onselect(index)} onfocus={() => onselect(index)} onclick={() => onselect(index)}
  onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onselect(index); } }}>
  <title>{label}</title>
  {@render children()}
</g>

<style>
  g { cursor: pointer; }
  g:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
</style>
