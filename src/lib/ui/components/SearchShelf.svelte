<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import type { MediaView, MediaCardPresentation } from '$lib/ui/types';
  import type { LibrarySurface } from '$lib/library';
  import { libraryTitles, librarySelections } from '$lib/library';
  import Shelf from './Shelf.svelte';
  import ContentRow from './ContentRow.svelte';
  import MediaCard from './MediaCard.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';
  import { invalidateAll } from '$app/navigation';
  let {
    surface,
    query,
    items,
    busy = false,
    failure = '',
    truncated = false,
    layout = 'row',
  }: {
    surface: LibrarySurface;
    query: string;
    items: (MediaView | MediaCardPresentation)[];
    busy?: boolean;
    failure?: string;
    truncated?: boolean;
    layout?: 'row' | 'grid';
  } = $props();
  const title = $derived(libraryTitles[surface]);
  let kind = $state(
    untrack(() => (layout === 'grid' ? (page.url.searchParams.get('kind') ?? 'all') : 'all'))
  );
  const watchItems = $derived(items.filter((item) => 'available' in item));
  const presentations = $derived(
    items.filter(
      (item): item is MediaCardPresentation =>
        'href' in item && (kind === 'all' || item.kind === kind)
    )
  );
  const href = $derived('/search?' + new URLSearchParams({ q: query, view: surface, kind }));
</script>

{#snippet notices()}{#if failure}<span role="alert">{failure}</span><Button
      variant="ghost"
      onclick={() => invalidateAll()}>Try again</Button
    >{/if}
  {#if truncated}<span class="small muted">Refine your search for more results.</span
    >{/if}{/snippet}
{#if surface === 'watch'}<Shelf
    {title}
    items={watchItems}
    {busy}
    {layout}
    rows={2}
    actions={notices}
    href={layout === 'row' ? href : undefined}
  >
    {#snippet empty()}<p class="muted" role="status">
        {busy ? 'Searching…' : 'No titles in this selection.'}
      </p>{/snippet}
  </Shelf>
{:else}<ContentRow
    {title}
    {busy}
    {layout}
    rows={2}
    size={surface === 'listen' ? 'square' : 'poster'}
    preserveHeight
    actions={notices}
    href={layout === 'row' ? href : undefined}
  >
    {#snippet controls()}{#if surface === 'listen'}<RowFilter
          label="Listen type"
          bind:value={kind}
          options={librarySelections.listen}
        />{/if}{/snippet}
    {#snippet children(style)}{#each presentations as item (item.href)}<MediaCard
          {item}
          {...style}
        />{/each}
      {#if !presentations.length && !failure}<p class="row-empty muted" role="status">
          {busy ? 'Searching…' : 'No titles in this selection.'}
        </p>{/if}
    {/snippet}
  </ContentRow>{/if}
