<script lang="ts">
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { untrack } from 'svelte';
  import { change, message } from '$lib/ui/client';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import type { JournalEntry } from '$lib/profile/journal';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  let { data } = $props();
  let selected = $state<string[]>([]),
    excluded = $state<string[]>([]),
    all = $state(false);
  let loaded = $state<JournalEntry[]>([]),
    busy = $state(false),
    error = $state(''),
    confirming = $state(false),
    revision = $state(0);
  const selectionKey = $derived(`${data.item.id}:${data.selecting}`);
  $effect(() => {
    selectionKey;
    untrack(() => {
      clear();
      error = '';
      confirming = false;
    });
  });
  const count = $derived(all ? data.activity.total - excluded.length : selected.length);
  const checked = (id: string) => (all ? !excluded.includes(id) : selected.includes(id));
  function toggle(id: string) {
    if (all)
      excluded = excluded.includes(id)
        ? excluded.filter((value) => value !== id)
        : [...excluded, id];
    else
      selected = selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id];
  }
  function clear() {
    selected = [];
    excluded = [];
    all = false;
  }
  async function remove() {
    busy = true;
    error = '';
    try {
      const result = await change<{ removed: number; queued: number }>(
        `media/${data.item.id}/history`,
        {
          eventIds: selected,
          all,
          excludedIds: excluded,
          expectedCount: count,
          before: data.historySnapshot,
        },
        'DELETE'
      );
      confirming = false;
      clear();
      revision += 1;
      notifyAction(
        `Removed ${result.removed} ${result.removed === 1 ? 'entry' : 'entries'} from history.${result.queued ? ' Connected-service updates queued.' : ''}`
      );
    } catch (cause) {
      error = message(cause);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{data.item.title} · History · Coast</title></svelte:head>
<MediaPage>
  <section class="section">
    <Heading title={`${data.item.title} · History`}>
      {#snippet actions()}
        {#if data.selecting}<Button href={`/media/${data.item.id}/history`} variant="ghost"
            >Done</Button
          >
        {:else}<Button href={`/media/${data.item.id}/history?remove=1`} variant="ghost"
            >Remove entries…</Button
          >{/if}
        <Button href={`/media/${data.item.id}`} variant="ghost" icon="left">View details</Button>
      {/snippet}
    </Heading>
    {#if data.selecting}
      <div class="selection-tools stack">
        <p>
          Select the entries you want to remove. For a show, season or collection, this includes its
          episodes or titles.
        </p>
        <div class="row">
          <Button
            variant="ghost"
            disabled={busy || !loaded.length}
            onclick={() => {
              all = false;
              excluded = [];
              selected = loaded.map((item) => item.eventId);
            }}>Select shown</Button
          >
          <Button
            variant="ghost"
            disabled={busy || !data.activity.total}
            onclick={() => {
              all = true;
              selected = [];
              excluded = [];
            }}>Select all {data.activity.total} entries</Button
          >
          <Button variant="ghost" disabled={busy || !count} onclick={clear}>Clear selection</Button>
          <Button
            variant="danger"
            disabled={busy || !count}
            onclick={() => {
              error = '';
              confirming = true;
            }}>Remove {count} {count === 1 ? 'entry' : 'entries'}…</Button
          >
        </div>
      </div>
    {/if}
    {#key `${data.item.id}:${data.selecting}:${revision}`}
      <Shelf source={{ type: 'journal', layout: "grid", items: data.activity.items, page: data.activity.page, pages: data.activity.pages, today: data.today, endpoint: `media/${data.item.id}/activity`, filters: {}, onitems: (items) => (loaded = items), selection: data.selecting ? { checked, toggle, disabled: busy } : undefined }} />
    {/key}
  </section>
</MediaPage>
<Dialog bind:open={confirming} title="Remove from history?">
  <div class="stack">
    <p>
      Remove <strong>{count} {count === 1 ? 'entry' : 'entries'}</strong> from
      <strong>{data.item.title}</strong>{['show', 'season', 'collection'].includes(data.item.kind)
        ? ' and its episodes or titles'
        : ''}?
    </p>
    <p>
      Your progress and stats will be recalculated from the history you keep. This cannot be undone.
      Matching Trakt history will be removed. Jellyfin’s watched status, play count and saved
      position will be updated to match the history you keep. Provider updates run as jobs; failures
      appear in Notifications.
    </p>
    {#if error}<p class="text-danger" role="alert">{error}</p>{/if}
    <div class="row">
      <Button variant="danger" disabled={busy || !count} onclick={remove}
        >Remove from history</Button
      ><Button variant="ghost" disabled={busy} onclick={() => (confirming = false)}
        >Keep entries</Button
      >
    </div>
  </div>
</Dialog>

<style>
  .selection-tools {
    margin-bottom: 24px;
  }
  .selection-tools .row {
    flex-wrap: wrap;
  }
</style>
