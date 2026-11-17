<script lang="ts">
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import Field from '#lib/ui/components/Field.svelte';
  import { onDestroy } from 'svelte';
  import { randomId } from '#lib/diagnostics.js';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { gameStatuses, type GameStatus } from '#lib/games/model.js';
  import type { GameActionState } from '#lib/media/work-actions.js';
  import { displayLabel } from '../labels';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import WorkHistory from './WorkHistory.svelte';
  let { workId, gameData, ensure, changed, created }: { workId: string; gameData?: GameActionState | null;
    ensure: () => Promise<unknown>; changed: () => Promise<unknown>; created?: (id: string) => Promise<void> } = $props();
  const { change } = useClient();
  const mutation = createMutation(() => changed(), useClient().feedback.notify, useRetention());
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  let alive = true;
  onDestroy(() => alive = false);
  let form = $state<'start' | 'progress' | 'log' | 'finish' | null>(null);
  let platform = $state(''), repeat = $state(false), percent = $state<number | undefined>(0), status = $state<GameStatus>('in-progress');
  let minutes = $state<number | undefined>(60), playedAt = $state(''), note = $state(''), sessionId = $state('');
  let target = $state(''), playthroughId = $state('');
  let historyOpen=$state(false),historyTarget=$state('');
  export async function showHistory(){
    const requestedWork=workId;
    if(!gameData&&await ensure()===undefined)return;
    if(!alive||workId!==requestedWork||!gameData?.playthrough)return;
    historyTarget=gameData.playthrough.id;historyOpen=true;
  }
  export async function open(action: NonNullable<typeof form>) {
    const requestedWork = workId;
    if (!gameData && await ensure() === undefined) return;
    if (!alive || workId !== requestedWork) return;
    const selected = gameData?.playthrough;
    if (action !== 'start' && !selected) return;
    target = workId; playthroughId = selected?.id ?? '';
    repeat = !!selected; platform = gameData?.platforms[0] ?? ''; percent = selected?.progressPercent ?? 0;
    status = selected?.status ?? 'in-progress';
    const now = new Date(); playedAt = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    sessionId = randomId(); minutes = 60; note = ''; mutation.error = ''; form = action;
  }
  export async function update(nextStatus: GameStatus) {
    const requestedWork = workId;
    if (!gameData && await ensure() === undefined) return;
    const selected = gameData?.playthrough;
    if (!selected || !alive || workId !== requestedWork) return;
    const id = selected.id;
    await mutation.run(() => change(`game-playthroughs/${id}`, { status: nextStatus }, 'PATCH'),
      nextStatus === 'completed' ? 'Playthrough marked finished.' : 'Playthrough updated.');
  }
  export function finish() { return update('completed'); }
  export function chooseFinishDate() { return open('finish'); }
  async function submit() {
    const action = form, id = target, selected = playthroughId;
    let createdId: string | undefined;
    const accepted = await mutation.run(async () => {
      if (action === 'start') {
        const result = await change<{ id: string }>(`games/${id}/playthroughs`, { platform: platform || undefined, repeat, status: 'in-progress' });
        createdId = result.id;
      } else if (action === 'progress') await change(`game-playthroughs/${selected}`, { status, progressPercent: percent }, 'PATCH');
      else if (action === 'log') await change(`game-playthroughs/${selected}/sessions`, { id: sessionId, minutesPlayed: minutes, playedAt: new Date(playedAt).toISOString(), note: note || undefined });
      else if (action === 'finish') {
        const date = new Date(playedAt);
        if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) throw new Error('Choose a valid completion date in the past.');
        await change(`game-playthroughs/${selected}`, { status: 'completed', completedAt: date.toISOString() }, 'PATCH');
      } else return false;
    }, action === 'log' ? 'Play session logged.' : action === 'finish' ? 'Playthrough marked finished.' : 'Playthrough updated.');
    if (accepted) {
      form = null;
      if (alive && createdId && created) {
        try { await created(createdId); }
        catch { mutation.error = 'Saved. The new playthrough could not be opened; reload to see it.'; }
      }
    }
  }
  reportFailure(()=>mutation.error);
</script>
<Dialog open={form !== null} onclose={() => form = null} title={form === 'start' ? repeat ? 'Start replaying' : 'Start a playthrough' : form === 'log' ? 'Log a play session' : form === 'finish' ? 'Mark as finished' : 'Update progress'}>
  <form class="stack" onsubmit={event => { event.preventDefault(); void submit(); }}>

    {#if form === 'start'}
      <Field label="Platform"><input bind:value={platform} maxlength="250" list={`platforms-${workId}`} placeholder="Choose a platform" /></Field>
      <datalist id={`platforms-${workId}`}>{#each gameData?.platforms ?? [] as entry}<option value={entry}></option>{/each}</datalist>
      <label class="check"><input type="checkbox" bind:checked={repeat} />This is a replay</label>
    {:else if form === 'progress'}
      <Field label="Completion percentage"><input type="number" bind:value={percent} required min="0" max="100" step="0.1" /></Field>
      <Field label="Status"><select bind:value={status}>{#each gameStatuses as entry}<option value={entry}>{displayLabel(entry)}</option>{/each}</select></Field>
    {:else if form === 'log'}
      <Field label="Time played (minutes)"><input type="number" bind:value={minutes} required min="1" max="1440" step="1" /></Field>
      <Field label="Played at"><input type="datetime-local" bind:value={playedAt} required /></Field>
      <Field label="Note"><textarea bind:value={note} maxlength="2000" rows="3"></textarea></Field>
    {:else if form === 'finish'}
      <Field label="Finished at"><input type="datetime-local" bind:value={playedAt} required /></Field>
    {/if}
    <Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : form === 'start' ? 'Start playthrough' : form === 'log' ? 'Save session' : form === 'finish' ? 'Mark as finished' : 'Save progress'}</Button>
  </form>
</Dialog>
<WorkHistory bind:open={historyOpen} target={historyTarget} kind="game" {changed} />
