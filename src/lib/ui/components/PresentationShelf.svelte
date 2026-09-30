<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { PresentationRow } from '$lib/server/queries/media-rows';
  import { librarySelections } from '$lib/library';
  import { api, message } from '$lib/ui/client';
  import ContentRow from './ContentRow.svelte';
  import MediaCard from './MediaCard.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';
  let {
    title,
    music = false,
    personal = false,
    empty = 'No items here yet.',
    refreshKey,
  }: {
    title: string;
    refreshKey?: unknown;
    music?: boolean;
    personal?: boolean;
    empty?: string;
  } = $props();
  let kind = $state('all'),
    content = $state<PresentationRow>({ items: [], failure: '' });
  let busy = $state(false),
    ready = $state(false),
    activated = false;
  let host: HTMLDivElement, controller: AbortController | undefined;
  const href = $derived(
    music ? `/music?kind=${kind}` : `/games${personal ? '?personal=true' : ''}`
  );
  async function load() {
    activated = true;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    busy = true;
    try {
      const result = await api<PresentationRow>(
        'library?' +
          new URLSearchParams({
            preview: 'true',
            surface: music ? 'listen' : 'play',
            selection: kind,
            personal: String(personal),
          }),
        undefined,
        'GET',
        { signal: request.signal }
      );
      if (!request.signal.aborted) {
        content = result;
        ready = true;
      }
    } catch (cause) {
      if (!request.signal.aborted) content = { ...content, failure: message(cause) };
    } finally {
      if (!request.signal.aborted) busy = false;
    }
  }
  $effect(() => {
    refreshKey;
    untrack(() => {
      if (activated) void load();
    });
  });
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          if (!activated) void load();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(host);
    return () => observer.disconnect();
  });
  onDestroy(() => controller?.abort());
</script>

<div bind:this={host}>
  <ContentRow
    {title}
    {href}
    {busy}
    preserveHeight
    size={music ? 'square' : 'poster'}
    mediaKind={music ? 'music' : 'game'}
    resetKey={kind}
  >
    {#snippet controls()}{#if music}<RowFilter
          label={`${title} type`}
          value={kind}
          options={librarySelections.listen}
          onchange={(value) => {
            kind = value;
            void load();
          }}
        />{/if}{/snippet}
    {#snippet actions()}{#if content.failure}<span role="alert">{content.failure}</span><Button
          variant="ghost"
          onclick={load}>Try again</Button
        >{/if}{/snippet}
    {#snippet children(style)}
      {#each content.items as item (item.href)}<MediaCard {item} {...style} />{/each}
      {#if !content.items.length && !content.failure}<p class="row-empty muted" role="status">
          {busy || !ready ? `Loading ${title.toLowerCase()}…` : empty}
          {#if ready && !busy}<a {href}>Browse {music ? 'music' : 'games'}</a>{/if}
        </p>{/if}
    {/snippet}
  </ContentRow>
</div>
