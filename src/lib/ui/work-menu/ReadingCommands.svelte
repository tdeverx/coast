<script lang="ts">
  import { useRetention } from '$lib/ui/retention';
  import { reportFailure } from '$lib/ui/client-context';
  import FormActions from '$lib/ui/components/FormActions.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import { onDestroy } from 'svelte';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { readingStates, type ReadingState } from '$lib/reading/model';
  import type { ReadingActionState } from '$lib/media/work-actions';
  import { displayLabel } from '../labels';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  let { workId, progress, ensure, changed }: { workId: string; progress?: ReadingActionState | null;
    ensure: () => Promise<unknown>; changed: () => Promise<unknown> } = $props();
  const { change } = useClient();
  const mutation = createMutation(() => changed(), useClient().feedback.notify, useRetention());
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  let alive = true;
  onDestroy(() => alive = false);
  let open = $state(false), readingState = $state<ReadingState>('reading'), currentPage = $state<number | undefined>(0), totalPages = $state<number | undefined>();
  let target = $state('');
  export async function edit() {
    const snapshot = await ensure();
    if (!alive || snapshot === undefined) return;
    target = workId; readingState = progress?.state ?? 'reading'; currentPage = progress?.page ?? 0;
    totalPages = progress?.totalPages ?? undefined; mutation.error = ''; open = true;
  }
  export async function setState(readingState: ReadingState, restart = false) {
    const id = workId;
    await mutation.run(() => change(`reading/${id}/progress`, { state: readingState, ...(restart ? { restart: true, page: 0 } : {}) }), 'Reading updated.');
  }
  async function save() {
    if (currentPage === undefined || !Number.isSafeInteger(currentPage) || currentPage < 0 || currentPage > 1000000 || (totalPages !== undefined && (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 1000000 || currentPage > totalPages))) {
      mutation.error = 'Enter a valid current page and total pages. The current page cannot exceed the total.'; return;
    }
    const id = target;
    if (await mutation.run(() => change(`reading/${id}/progress`, { state: readingState, page: currentPage, totalPages: totalPages ?? null }), 'Reading progress saved.')) open = false;
  }
  reportFailure(()=>mutation.error);
</script>
<Dialog bind:open title="Update reading progress">
  <form class="stack" onsubmit={event => { event.preventDefault(); void save(); }}>
    <Field label="Reading state"><select bind:value={readingState}>{#each readingStates as entry}<option value={entry}>{displayLabel(entry)}</option>{/each}</select></Field>
    <Field label="Current page"><input type="number" bind:value={currentPage} required min="0" max="1000000" step="1" /></Field>
    <Field label="Total pages (optional)"><input type="number" bind:value={totalPages} min="1" max="1000000" step="1" placeholder="Page count of your edition" /></Field>
    <p class="small quiet">Completing the page count keeps your current reading state. Choose Completed when you have finished.</p>
    <FormActions><Button disabled={mutation.busy} onclick={() => open = false}>Cancel</Button><Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : 'Save progress'}</Button></FormActions>
  </form>
</Dialog>
