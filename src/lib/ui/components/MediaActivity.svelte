<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { onDestroy, untrack } from 'svelte';
  import type { ProfilePeriod } from '#lib/profile/period.js';
  import type { MediaStatistics } from '#lib/media/statistics.js';
  import { useClient } from '#lib/ui/client-context.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { mediaActivityPanels } from '#lib/ui/insights/media.js';
  import DetailCard from './DetailCard.svelte';

  const { api } = useClient();

  let { mediaId, period }: { mediaId: string; period: ProfilePeriod } = $props();
  const resource = createResource<MediaStatistics | null>(null);
  const data = $derived(resource.data);
  const error = $derived(resource.error);
  let loadedPeriod = $state(untrack(() => period));
  async function load(id: string, selected: ProfilePeriod) {
    const path = `media/${id}/statistics?period=${selected}`;
    const result = await resource.load(signal => api<MediaStatistics>(path, undefined, 'GET', { signal }));
    if (result) loadedPeriod = selected;
  }
  $effect(() => {
    const id = mediaId,
      selected = period;
    untrack(() => {
      void load(id, selected);
    });
  });
  onDestroy(resource.dispose);

  reportFailure(()=>error,()=>load(mediaId,period));
</script>

{#if data}{#each mediaActivityPanels(data,loadedPeriod) as panel}<DetailCard {...panel} />{/each}{/if}
