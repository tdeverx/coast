<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import { heroTitleIds, isHeroTitle } from '$lib/media/hero';
  import { api } from '$lib/ui/client';
  import MediaHero from './MediaHero.svelte';
  let {
    items,
    selection,
    busy = false,
  }: { items: MediaView[]; selection: string; busy?: boolean } = $props();
  let mounted = $state(false);
  let chosen = $state<MediaView | null>(null);
  let previousSelection = '';
  onMount(() => {
    mounted = true;
  });
  $effect(() => {
    if (!mounted || busy) return;
    const ids = heroTitleIds(items);
    const current = untrack(() => chosen);
    if (selection === previousSelection && ids.includes(current?.id ?? '')) return;
    const controller = new AbortController();
    const key = selection;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const existing = items.find((item) => item.id === id && isHeroTitle(item));
    if (!id || existing) {
      chosen = existing ?? null;
      previousSelection = key;
    } else {
      // Resolve only the selected parent, without delaying the page or its rows.
      void api<MediaView[]>(`heroes?ids=${id}`, undefined, 'GET', { signal: controller.signal })
        .then((titles) => {
          if (controller.signal.aborted) return;
          chosen = titles.find(isHeroTitle) ?? null;
          previousSelection = key;
        })
        .catch(() => {
          if (!controller.signal.aborted) chosen = null;
        });
    }
    return () => controller.abort();
  });
</script>

{#if chosen}<MediaHero item={chosen} context="home" />{/if}
