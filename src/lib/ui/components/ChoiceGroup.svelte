<script lang="ts">
  import Button from './Button.svelte';
  let { label, value, options, change, defaultOption = false }: {
    label: string; value: string | null; options: { value: string; label: string }[];
    change: (value: string | null) => void; defaultOption?: boolean;
  } = $props();
</script>
<div role="group" aria-label={label}>
  {#if defaultOption}
    <Button item selection="radio" checked={value === null} onclick={() => change(null)}>Use default</Button>
    <div class="menu-divider" role="separator"></div>
  {:else}<div class="menu-label">{label}</div>{/if}
  {#each options as option (option.value)}
    <Button item text={option.label} selection="radio" checked={value === option.value}
      keepOpen={defaultOption} onclick={() => { if (value !== option.value) change(option.value); }} />
  {/each}
</div>
