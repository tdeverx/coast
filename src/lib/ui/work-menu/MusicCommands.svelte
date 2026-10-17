<script lang="ts">
  import Field from '$lib/ui/components/Field.svelte';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import Dialog from '../components/Dialog.svelte';
  import Button from '../components/Button.svelte';
  let { workId, album = false, changed }: { workId: string; album?: boolean; changed: () => Promise<unknown> } = $props();
  const { change } = useClient();
  const mutation = createMutation(() => changed(), useClient().feedback.notify);
  let logOpen = $state(false), date = $state(''), batch = $state('');
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  export function showDate() {
    const now = new Date(); date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    batch = crypto.randomUUID(); mutation.error = ''; logOpen = true;
  }
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
    <Field label="Listened at"><input type="datetime-local" bind:value={date} required /></Field>
    <Button type="submit" disabled={mutation.busy}>Log {album ? 'album' : 'listen'}</Button>
  </form>
</Dialog>
