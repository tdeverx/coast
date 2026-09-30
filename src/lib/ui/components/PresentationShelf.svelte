<script lang="ts">
  import type { MediaCardPresentation } from '$lib/ui/types';
  import ContentRow from './ContentRow.svelte';
  import MediaCard from './MediaCard.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';
  import { invalidateAll } from '$app/navigation';
  let {
    title,
    href,
    items = [],
    music = false,
    types = true,
    busy = false,
    failure = '',
    empty = 'No items here yet.',
    layout = 'row',
  }: {
    title: string;
    href?: string;
    items?: MediaCardPresentation[];
    music?: boolean;
    types?: boolean;
    busy?: boolean;
    failure?: string;
    empty?: string;
    layout?: 'row' | 'grid';
  } = $props();
  let kind = $state('all');
  const visible = $derived(items.filter((item) => kind === 'all' || item.kind === kind));
</script>

<ContentRow {title} {href} {layout} {busy} size={music ? 'square' : 'poster'}>
  {#snippet controls()}{#if music && types}<RowFilter
        label={`${title} type`}
        bind:value={kind}
        options={[
          { value: 'all', label: 'All' },
          { value: 'album', label: 'Albums' },
          { value: 'artist', label: 'Artists' },
          { value: 'track', label: 'Tracks' },
        ]}
      />{/if}{/snippet}
  {#snippet children(style)}
    {#if failure}<div class="row-empty">
        <p class="notice error" role="alert">{failure}</p>
        <Button variant="ghost" onclick={() => invalidateAll()}>Try again</Button>
      </div>{/if}
    {#if busy}<p class="row-empty muted" role="status">Loading {title.toLowerCase()}…</p>
    {:else if visible.length}{#each visible as item (`${item.href}`)}<MediaCard
          {item}
          {...style}
        />{/each}
    {:else if !failure}<p class="row-empty muted">
        {kind === 'all' ? empty : 'No music in this selection.'}{#if href}
          <a {href}>Browse {music ? 'music' : 'games'}</a>{/if}
      </p>{/if}
  {/snippet}
</ContentRow>
