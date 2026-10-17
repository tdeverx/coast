<script lang="ts">
  import { reportFailure } from '$lib/ui/client-context';
  import Field from '$lib/ui/components/Field.svelte';
  import { onDestroy } from 'svelte';
  import { randomId } from '$lib/diagnostics';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import { gameStatuses, type GameStatus } from '$lib/games/model';
  import type { GameActionState } from '$lib/media/work-actions';
  import { displayLabel } from '../labels';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  let { workId, gameData, ensure, changed, created }: { workId: string; gameData?: GameActionState | null;
    ensure: () => Promise<unknown>; changed: () => Promise<unknown>; created?: (id: string) => Promise<void> } = $props();
  const { change } = useClient();
  const mutation = createMutation(() => changed(), useClient().feedback.notify);
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  let alive = true;
  onDestroy(() => alive = false);
  let form = $state<'start' | 'progress' | 'log' | null>(null);
  let platform = $state(''), repeat = $state(false), percent = $state<number | undefined>(0), status = $state<GameStatus>('in-progress');
  let minutes = $state<number | undefined>(60), playedAt = $state(''), note = $state(''), sessionId = $state('');
  let target = $state(''), playthroughId = $state('');
  export async function open(action: NonNullable<typeof form>) {
    if (!gameData) await ensure();
    if (!alive) return;
    const selected = gameData?.playthrough;
    if (action !== 'start' && !selected) return;
    target = workId; playthroughId = selected?.id ?? '';
    repeat = !!selected; platform = gameData?.platforms[0] ?? ''; percent = selected?.progressPercent ?? 0;
    status = selected?.status ?? 'in-progress';
    const now = new Date(); playedAt = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    sessionId = randomId(); minutes = 60; note = ''; mutation.error = ''; form = action;
  }
  export async function update(nextStatus: GameStatus) {
    if (!gameData) await ensure();
    const selected = gameData?.playthrough;
    if (!selected || !alive) return;
    await mutation.run(() => change(`game-playthroughs/${selected.id}`, { status: nextStatus }, 'PATCH'), 'Playthrough updated.');
  }
  async function submit() {
    const action = form, id = target, selected = playthroughId;
    let createdId: string | undefined;
    const accepted = await mutation.run(async () => {
      if (action === 'start') {
        const result = await change<{ id: string }>(`games/${id}/playthroughs`, { platform: platform || undefined, repeat, status: 'in-progress' });
        createdId = result.id;
      } else if (action === 'progress') await change(`game-playthroughs/${selected}`, { status, progressPercent: percent }, 'PATCH');
      else if (action === 'log') await change(`game-playthroughs/${selected}/sessions`, { id: sessionId, minutesPlayed: minutes, playedAt: new Date(playedAt).toISOString(), note: note || undefined });
    }, action === 'log' ? 'Play session logged.' : 'Playthrough updated.');
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
<Dialog open={form !== null} onclose={() => form = null} title={form === 'start' ? repeat ? 'Start replaying' : 'Start a playthrough' : form === 'log' ? 'Log a play session' : 'Update progress'}>
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
    {/if}
    <Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : form === 'start' ? 'Start playthrough' : form === 'log' ? 'Save session' : 'Save progress'}</Button>
  </form>
</Dialog>
