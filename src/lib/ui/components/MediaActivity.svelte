<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { ProfilePeriod } from '$lib/profile/period';
  import type { MediaStatistics } from '$lib/media/statistics';
  import { api } from '$lib/ui/client';
  import { createResource } from '$lib/ui/resource.svelte';
  import { mediaActivityPanels } from '$lib/ui/insights/media';
  import DetailCard from './DetailCard.svelte';
  import Button from './Button.svelte';
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
  onDestroy(resource.cancel);
</script>

{#if error}<DetailCard title="Activity unavailable"
    ><p role="alert">{error}</p>
    <Button variant="ghost" onclick={() => load(mediaId, period)}>Try again</Button></DetailCard
  >{/if}
{#if data}{#each mediaActivityPanels(data,loadedPeriod) as panel}<DetailCard {...panel} />{/each}{/if}
