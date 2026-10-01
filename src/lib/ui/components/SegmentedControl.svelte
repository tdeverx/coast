<script lang="ts">
  import { slidingPill } from '$lib/ui/materials/sliding-pill';
  let {
    options,
    value = $bindable(),
    onchange,
    label,
  }: {
    label?: string;
    options: { value: string; label: string }[];
    value: string;
    onchange?: (value: string) => void;
  } = $props();
</script>

<div class="picker-container scrollable">
  <div class="segmented-control" role="group" aria-label={label} use:slidingPill>
    {#each options as option}<button
        type="button"
        aria-pressed={value === option.value}
        onclick={() => {
          value = option.value;
          onchange?.(value);
        }}>{option.label}</button
      >{/each}
  </div>
</div>

<style>
  .picker-container {
    min-width: 0;
  }
  .scrollable {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: thin;
    overscroll-behavior-x: contain;
    padding: 3px;
  }
  .scrollable .segmented-control {
    width: max-content;
  }
  .scrollable button {
    flex: none;
    white-space: nowrap;
  }
</style>
