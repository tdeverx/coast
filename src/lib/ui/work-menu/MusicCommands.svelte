<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { createMenuResource } from '../controls/menu-resource.svelte';
  import { workMenuScope } from '../controls/work.svelte';
  import Dialog from '../components/Dialog.svelte';
  import Button from '../components/Button.svelte';
  import DetailCard from '../components/DetailCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  let { workId, album = false, changed }: { workId: string; album?: boolean; changed: () => Promise<unknown> } = $props();
  const { change, api } = useClient();
  const mutation = createMutation(() => changed());
  let logOpen = $state(false), historyOpen = $state(false), date = $state(''), batch = $state('');
  let number = $state(1);
  type History = { items: { id: string; title: string; occurredAt: string; dateKnown: boolean; source: string }[]; page: number; pages: number; total: number };
  const history = createMenuResource<History>(() => ({ items: [], page: 1, pages: 1, total: 0 }),
    () => workMenuScope([workId, number]), signal => api(`music/${workId}/history?page=${number}`, undefined, 'GET', { signal }));
  $effect(() => { const key = workMenuScope([workId, number]); untrack(() => { key; history.sync(); if (history.active) void history.load(); }); });
  onDestroy(history.dispose);
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  export function showDate() {
    const now = new Date(); date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    batch = crypto.randomUUID(); mutation.error = ''; logOpen = true;
  }
  export function showHistory() { historyOpen = true; void history.open(); }
  export async function log(at?: string) {
    const id = workId;
    if (!batch) batch = crypto.randomUUID();
    if (await mutation.run(() => change(`music/${id}/log`, { batchId: batch, ...(at ? { occurredAt: at } : {}) }), album ? 'Album logged.' : 'Listen logged.')) {
      batch = ''; logOpen = false;
    }
  }
</script>
<Dialog bind:open={logOpen} title={album ? 'Log album' : 'Log listen'}>
  <form class="stack" onsubmit={event => { event.preventDefault(); void log(new Date(date).toISOString()); }}>
    {#if mutation.error}<p role="alert" class="notice error">{mutation.error}</p>{/if}
    <label class="field">Listened at<input type="datetime-local" bind:value={date} required /></label>
    <Button type="submit" disabled={mutation.busy}>Log {album ? 'album' : 'listen'}</Button>
  </form>
</Dialog>
<Dialog bind:open={historyOpen} onclose={history.close} title="Listening history">
  {#if album}<p class="small quiet">Tracks in the selected album edition.</p>{/if}
  {#if history.busy}<p role="status" class="small quiet">Loading history…</p>{/if}
  <div class="stack">{#each history.data.items as event (event.id)}<DetailCard title={event.title} description={event.dateKnown ? new Date(event.occurredAt).toLocaleString() : 'Date not provided'} />{:else}{#if !history.busy && !history.error}<EmptyState title="No listens yet" description="Log a listen or play this title to add history." icon="clock" />{/if}{/each}</div>
  {#if history.error}<p role="alert" class="notice error">{history.error}</p><Button onclick={() => history.load(true)}>Retry</Button>{/if}
  {#if history.data.pages > 1}<div class="row"><Button disabled={history.busy || history.data.page <= 1} onclick={() => number = history.data.page - 1}>Previous</Button><Button disabled={history.busy || history.data.page >= history.data.pages} onclick={() => number = history.data.page + 1}>Next</Button></div>{/if}
</Dialog>
