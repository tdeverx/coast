<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import RowHeader from './RowHeader.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  let {
    title = 'Library',
    surface,
    enabled = false,
    filters: filterContent,
    actions: actionContent,
    onchange,
  }: {
    title?: string;
    surface: 'watch' | 'listen' | 'play';
    enabled?: boolean;
    filters?: Snippet;
    actions?: Snippet;
    onchange?: (value: 'watch' | 'listen' | 'play') => void;
  } = $props();
  function select(value: string) {
    const next = value as typeof surface;
    if (onchange) onchange(next);
    else void goto(next === 'watch' ? '/library' : next === 'listen' ? '/music' : '/games');
  }
</script>

<RowHeader {title}>
  {#snippet heading()}<h1>{title}</h1>{/snippet}
  {#snippet filters()}
    {#if enabled}<SegmentedControl
        label={`${title} media`}
        value={surface}
        onchange={select}
        options={[
          { value: 'watch', label: 'Watch' },
          { value: 'listen', label: 'Listen' },
          { value: 'play', label: 'Play' },
        ]}
      />{/if}
  {/snippet}
  {#snippet actions()}{#if filterContent}{@render filterContent()}{/if}{#if actionContent}{@render actionContent()}{/if}{/snippet}
</RowHeader>

<style>
  h1 {
    font-size: var(--row-title-size);
    font-weight: var(--row-title-weight);
    margin: 0;
  }
</style>
