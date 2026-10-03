<script lang="ts">
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { api, change } from '$lib/ui/client';
  import { createOperation } from '$lib/ui/operation.svelte';
  import { playMedia } from '$lib/playback/client.svelte';
  import { startSynced, syncedPlayer } from '$lib/playback/synced/client.svelte';
  let { data } = $props();
  const operation = createOperation();

  function start(id: string) {
    const plan = data.plans.find(plan => plan.id === id);
    if (!plan) return;
    void operation.run(async () => {
      await playMedia(plan.workId);
      if (plan.party) {
        await startSynced();
        const room = syncedPlayer.room;
        if (!room) throw new Error(syncedPlayer.notice || 'The party could not start.');
        for (const friendId of plan.friends) await api(`synced/${room.id}/invite`, { friendId });
      }
      await change(`planning/${id}/complete`, {});
      await invalidate('coast:planning');
    });
  }
  function finish(id: string, cancel = false) {
    void operation.run(async () => {
      if (cancel) await change(`planning/${id}`, undefined, 'DELETE');
      else await change(`planning/${id}/complete`, {});
      await invalidate('coast:planning');
    });
  }
  function pageUrl(number: number) {
    const url = new URL(page.url);
    url.searchParams.set('page', String(number));
    return url.pathname + url.search;
  }
</script>

<svelte:head><title>Planning · Coast</title></svelte:head>
<div class="content page">
  <Heading title="Planning" variant="page" description="Experimental · your scheduled plans. Visual treatment unapproved." />
  {#if operation.error}<p class="notice error" role="alert">{operation.error}</p>{/if}
  <Shelf title="Your plans" items={data.items} layout="grid" availability={false} hideEmpty={false} pageNumber={data.page} pages={data.pages} {pageUrl}>
    {#snippet details(item)}
      <div class="row">
        {#if ['movie', 'episode', 'track'].includes(item.kind)}
          <Button compact disabled={operation.busy} onclick={() => start(item.entryId!)}>Start</Button>
        {:else}
          <Button compact href={'href' in item ? item.href : `/media/${item.id}`}>View</Button>
          <Button compact disabled={operation.busy} onclick={() => finish(item.entryId!)}>Done</Button>
        {/if}
        <Button compact emphasis="subtle" disabled={operation.busy} onclick={() => finish(item.entryId!, true)}>Cancel</Button>
      </div>
    {/snippet}
    {#snippet empty()}<p class="muted">Use Plan in a title’s menu to schedule it.</p>{/snippet}
  </Shelf>
</div>
