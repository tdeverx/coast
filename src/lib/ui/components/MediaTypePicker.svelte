<script lang="ts">
  import RowFilter from './RowFilter.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  let {
    value = $bindable('all'),
    compact = false,
    label = 'Media type',
    onchange,
  }: {
    value?: 'all' | 'movie' | 'show';
    compact?: boolean;
    label?: string;
    onchange?: (value: 'all' | 'movie' | 'show') => void;
  } = $props();
</script>

{#if compact}<RowFilter
    {label}
    {value}
    options={[
      { value: 'all', label: 'All' },
      { value: 'movie', label: 'Movies' },
      { value: 'show', label: 'Shows' },
    ]}
    onchange={(next) => {
      value = next as typeof value;
      onchange?.(value);
    }}
  />{:else}
  <SegmentedControl
    {label}
    {value}
    options={[
      { value: 'all', label: 'All' },
      { value: 'movie', label: 'Movies' },
      { value: 'show', label: 'Shows' },
    ]}
    onchange={(next) => {
      value = next as typeof value;
      onchange?.(value);
    }}
  />
{/if}
