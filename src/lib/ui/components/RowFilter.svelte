<script lang="ts" generics="T extends string = string">
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  let {
    label,
    value = $bindable(),
    options,
    onchange,
  }: {
    label: string;
    value: T;
    options: { value: string; label: string }[];
    onchange?: (value: T) => void;
  } = $props();
  const selected = $derived(options.find((option) => option.value === value)?.label ?? label);
</script>

<div class="row-filter">
  <ContextMenu label={`${label}: ${selected}`} triggerClass="row-filter-trigger">
    {#snippet trigger()}{selected}{/snippet}
    {#each options as option}
      <MenuAction
        selection="radio"
        checked={value === option.value}
        keepOpen={false}
        onclick={() => {
          if (value === option.value) return;
          value = option.value as T;
          onchange?.(value);
        }}
      >{option.label}</MenuAction>
    {/each}
  </ContextMenu>
</div>

<style>
  .row-filter {
    min-width: 0;
  }
  .row-filter :global(.row-filter-trigger) {
    max-width: 160px;
    min-width: 0;
    height: var(--control-compact-height);
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    box-shadow: none;
  }
  .row-filter :global(.row-filter-trigger:hover),
  .row-filter :global(.row-filter-trigger:focus-visible) {
    color: var(--ink);
  }
</style>
