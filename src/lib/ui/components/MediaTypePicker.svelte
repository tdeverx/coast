<script lang="ts" generics="T extends 'all' | 'movie' | 'show' | 'album' | 'track' | 'game' = 'all' | 'movie' | 'show'">
  import RowFilter from './RowFilter.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  let {
    value = $bindable('all' as T),
    compact = false,
    includeOtherMedia = false,
    label = 'Media type',
    onchange,
  }: {
    value?: T;
    includeOtherMedia?: boolean;
    compact?: boolean;
    label?: string;
    onchange?: (value: T) => void;
  } = $props();
</script>

{#if compact}<RowFilter
    {label}
    {value}
    options={[
      { value: 'all', label: 'All' },
      { value: 'movie', label: 'Movies' },
      { value: 'show', label: 'Shows' },
      ...(includeOtherMedia ? [{ value: 'album', label: 'Albums' }, { value: 'track', label: 'Tracks' }, { value: 'game', label: 'Games' }] : []),
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
      ...(includeOtherMedia ? [{ value: 'album', label: 'Albums' }, { value: 'track', label: 'Tracks' }, { value: 'game', label: 'Games' }] : []),
    ]}
    onchange={(next) => {
      value = next as typeof value;
      onchange?.(value);
    }}
  />
{/if}
