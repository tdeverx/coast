<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import Shelf from '#lib/ui/components/Shelf.svelte';
  import { untrack } from 'svelte';
  import { change, message } from '#lib/ui/client.js';
  import { notifyAction } from '#lib/ui/action-feedback.svelte.js';
  import type { JournalEntry } from '#lib/profile/journal.js';
  import MediaPage from '#lib/ui/components/MediaPage.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  let { data } = $props();
  let selected = $state<string[]>([]),
    excluded = $state<string[]>([]),
    all = $state(false);
  let loaded = $state<JournalEntry[]>([]),
    busy = $state(false),
    error = $state(''),
    confirming = $state(false),
    revision = $state(0);
  const selectionKey = $derived(data.item.id);
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
  reportFailure(()=>error);
</script>

<svelte:head><title>{data.item.title} · Manage history · Coast</title></svelte:head>
<MediaPage>
  <section class="section">
    <Heading title={`${data.item.title} · Manage history`}>
      {#snippet actions()}
        <Button href={`/media/${data.item.id}?section=activity&relationship=consumed`} emphasis="subtle">Done</Button>
        <Button href={`/media/${data.item.id}`} emphasis="subtle" icon="left">View details</Button>
      {/snippet}
    </Heading>
      <div class="selection-tools stack">
        <p>
          Select the entries you want to remove. For a show, season or collection, this includes its
          episodes or titles.
        </p>
        <div class="row">
          <Button
            emphasis="subtle"
            disabled={busy || !loaded.length}
            onclick={() => {
              all = false;
              excluded = [];
              selected = loaded.map((item) => item.eventId);
            }}>Select shown</Button
          >
          <Button
            emphasis="subtle"
            disabled={busy || !data.activity.total}
            onclick={() => {
              all = true;
              selected = [];
              excluded = [];
            }}>Select all {data.activity.total} entries</Button
          >
          <Button emphasis="subtle" disabled={busy || !count} onclick={clear}>Clear selection</Button>
          <Button
            danger
            disabled={busy || !count}
            onclick={() => {
              error = '';
              confirming = true;
            }}>Remove {count} {count === 1 ? 'entry' : 'entries'}…</Button
          >
        </div>
      </div>
    {#key `${data.item.id}:${revision}`}
      <Shelf source={{ type: 'journal', layout: "grid", items: data.activity.items, page: data.activity.page, pages: data.activity.pages, today: data.today, endpoint: `media/${data.item.id}/activity`, filters: {}, onitems: (items) => (loaded = items), selection: { checked, toggle, disabled: busy } }} />
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
    <div class="row">
      <Button danger disabled={busy || !count} onclick={remove}
        >Remove from history</Button
      ><Button emphasis="subtle" disabled={busy} onclick={() => (confirming = false)}
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
