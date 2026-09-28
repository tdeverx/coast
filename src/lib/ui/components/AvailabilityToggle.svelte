<script lang="ts">
  import Icon from './Icon.svelte';
  let { value = false, onchange }: { value?: boolean; onchange: (available: boolean) => void } =
    $props();
</script>

<button
  type="button"
  class="availability-toggle"
  class:active={value}
  aria-label="Available to play only"
  aria-pressed={value}
  title={value ? 'Available titles · Show all titles' : 'All titles · Show available only'}
  onclick={() => onchange(!value)}><Icon name="play" size={18} filled={value} /></button
>

<style>
  .availability-toggle {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: var(--control-compact-height);
    height: var(--control-compact-height);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: color 150ms ease;
  }
  .availability-toggle:hover,
  .availability-toggle:focus-visible,
  .availability-toggle.active {
    color: var(--ink);
  }
</style>
