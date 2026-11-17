<script lang="ts">
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import FormActions from '#lib/ui/components/FormActions.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import { onDestroy } from 'svelte';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { readingStates, type ReadingState } from '#lib/reading/model.js';
  import type { ReadingActionState } from '#lib/media/work-actions.js';
  import { displayLabel } from '../labels';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import WorkHistory from './WorkHistory.svelte';
  let { workId, progress, ensure, changed }: { workId: string; progress?: ReadingActionState | null;
    ensure: () => Promise<unknown>; changed: () => Promise<unknown> } = $props();
  const { change } = useClient();
  const mutation = createMutation(() => changed(), useClient().feedback.notify, useRetention());
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  let alive = true;
  onDestroy(() => alive = false);
  let form = $state<'progress' | 'complete' | 'reread' | 'position' | 'unread' | null>(null);
  let readingState = $state<ReadingState>('reading'), currentPage = $state<number | undefined>(0), totalPages = $state<number | undefined>();
  let target = $state(''), date = $state('');
  let historyOpen=$state(false),historyTarget=$state('');
  export function showHistory(){historyTarget=workId;historyOpen=true;}
  export async function edit() {
    const id = workId;
    const snapshot = await ensure();
    if (!alive || workId !== id || snapshot === undefined) return;
    target = id; readingState = progress?.state ?? 'reading'; currentPage = progress?.page ?? 0;
    totalPages = progress?.totalPages ?? undefined; mutation.error = ''; form = 'progress';
  }
  export async function setState(readingState: ReadingState, restart = false) {
    if (restart) return startReread();
    const id = workId;
    await mutation.run(() => change(`reading/${id}/progress`, { state: readingState }), 'Reading updated.');
  }
  function record(id: string, action: 'complete' | 'reread', occurredAt?: string) {
    const state = action === 'reread' ? { state: 'reading', restart: true, page: 0 } : { state: 'completed' };
    return mutation.run(() => change(`reading/${id}/progress`, { ...state, ...(occurredAt ? { occurredAt } : {}) }),
      action === 'reread' ? 'Reread started.' : 'Marked as read.');
  }
  export function complete() { return record(workId, 'complete'); }
  export function startReread() { return record(workId, 'reread'); }
  export function canEndReread() { return Boolean(progress?.rereadId); }
  export function endReread() {
    const id = workId, endReread = progress?.rereadId;
    if (!endReread) return;
    return mutation.run(() => change(`reading/${id}/progress`, { endReread }), 'Reread ended. Previous progress restored.');
  }
  export function chooseDate(action: 'complete' | 'reread') {
    const now = new Date();
    target = workId;
    date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    mutation.error = ''; form = action;
  }
  export function reset(action: 'position' | 'unread') {
    target = workId;
    mutation.error = ''; form = action;
  }
  async function save() {
    const id = target, action = form;
    if (action === 'position' || action === 'unread') {
      if (await mutation.run(() => change(`reading/${id}/progress`, { reset: action }),
        action === 'unread' ? 'Marked as unread. Reading history is preserved.' : 'Reading position reset. Reading history is preserved.')) form = null;
      return;
    }
    if (action === 'complete' || action === 'reread') {
      const selected = new Date(date);
      if (!Number.isFinite(selected.getTime()) || selected.getTime() > Date.now()) {
        mutation.error = 'Choose a valid reading date in the past.';
        return;
      }
      if (await record(id, action, selected.toISOString())) form = null;
      return;
    }
    if (action !== 'progress') return;
    if (currentPage === undefined || !Number.isSafeInteger(currentPage) || currentPage < 0 || currentPage > 1000000 || (totalPages !== undefined && (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 1000000 || currentPage > totalPages))) {
      mutation.error = 'Enter a valid current page and total pages. The current page cannot exceed the total.'; return;
    }
    if (await mutation.run(() => change(`reading/${id}/progress`, { state: readingState, page: currentPage, totalPages: totalPages ?? null }), 'Reading progress saved.')) form = null;
  }
  reportFailure(()=>mutation.error);
</script>
<Dialog open={form !== null} onclose={() => { form = null; }}
  title={form === 'unread' ? 'Mark unread?' : form === 'position' ? 'Reset reading position?' : form === 'reread' ? 'Start reread' : form === 'complete' ? 'Mark as read' : 'Update reading progress'}>
  <form class="stack" onsubmit={event => { event.preventDefault(); void save(); }}>
    {#if form === 'progress'}
      <Field label="Reading state"><select bind:value={readingState}>{#each readingStates as entry}<option value={entry}>{displayLabel(entry)}</option>{/each}</select></Field>
      <Field label="Current page"><input type="number" bind:value={currentPage} required min="0" max="1000000" step="1" /></Field>
      <Field label="Total pages (optional)"><input type="number" bind:value={totalPages} min="1" max="1000000" step="1" placeholder="Page count of your edition" /></Field>
      <p class="small quiet">Completing the page count keeps your current reading state. Choose Completed when you have finished.</p>
    {:else if form === 'unread' || form === 'position'}
      <p>{form === 'unread'
        ? 'Marks this title unread and clears its saved position in every edition. Reading history is kept.'
        : 'Clears the saved position in every edition. Reading status and history are kept.'}</p>
    {:else}
      <Field label={form === 'reread' ? 'Reread start date' : 'Finished at'}><input type="datetime-local" bind:value={date} required /></Field>
    {/if}
    <FormActions>
      <Button disabled={mutation.busy} onclick={() => { form = null; }}>Cancel</Button>
      <Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : form === 'unread' ? 'Mark unread' : form === 'position' ? 'Reset reading position' : form === 'reread' ? 'Start reread' : form === 'complete' ? 'Mark as read' : 'Save progress'}</Button>
    </FormActions>
  </form>
</Dialog>
<WorkHistory bind:open={historyOpen} target={historyTarget} kind="reading" {changed} />
