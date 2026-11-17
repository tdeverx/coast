<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import Field from '#lib/ui/components/Field.svelte';
  import { useClient } from '../client-context';
  import { createMutation } from '../mutation.svelte';
  import Dialog from '../components/Dialog.svelte';
  import Button from '../components/Button.svelte';
  import FormActions from '../components/FormActions.svelte';
  import WorkHistory from './WorkHistory.svelte';
  import { createMenuResource } from '../controls/menu-resource.svelte';
  import { retryMenuRead } from '../controls/menu-read-retry';
  import { workMenuScope } from '../controls/work.svelte';
  let { workId, album = false, artist = false, changed }: { workId: string; album?: boolean; artist?: boolean; changed: () => Promise<unknown> } = $props();
  const { change, api } = useClient();
  const mutation = createMutation(() => changed(), useClient().feedback.notify, useRetention());
  let logOpen = $state(false), date = $state(''), batch = $state(''), target = $state('');
  let logKind = $state<'track'|'album'|'artist'>('track');
  let number = $state(1), selected = $state<{id:string;title:string}>();
  let historyOpen = $state(false);
  let resetOpen=$state(false),resetTarget=$state('');
  const choices = createMenuResource<{items:{id:string;title:string}[];hasMore:boolean}>(
    () => ({items:[],hasMore:false}), () => workMenuScope([target,number]),
    signal => api(`music/${target}/log-options?page=${number}`,undefined,'GET',{signal}), retryMenuRead);
  $effect(() => {
    const open = logOpen && logKind==='artist', scope = workMenuScope([target,number]);
    untrack(() => { choices.sync(scope); if(open)void choices.open();else choices.close(); });
  });
  onDestroy(choices.dispose);
  export function failure() { return mutation.error; }
  export function isBusy() { return mutation.busy; }
  export function showDate() {
    const now = new Date(); date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    target = workId; logKind = artist?'artist':album?'album':'track'; number = 1; selected = undefined;
    batch = crypto.randomUUID(); mutation.error = ''; logOpen = true;
  }
  export function showHistory() { target=workId;historyOpen=true; }
  export function resetPosition(){
    if(album||artist)return;
    resetTarget=workId;resetOpen=true;
  }
  async function confirmReset(){
    const id=resetTarget;
    if(await mutation.run(()=>change(`music/${id}/reset-position`,{}),'Playback position reset. Listening history is preserved.'))resetOpen=false;
  }
  export async function log(at?: string) {
    if(artist && !logOpen){showDate();return;}
    const kind = logOpen?logKind:artist?'artist':album?'album':'track';
    const id = kind==='artist' ? selected?.id : logOpen ? target : workId;
    if(!id)return;
    if (!batch) batch = crypto.randomUUID();
    if (await mutation.run(() => change(`music/${id}/log`, { batchId: batch, ...(at ? { occurredAt: at } : {}) }), kind==='album' ? 'Album logged.' : 'Listen logged.')) {
      batch = ''; logOpen = false;
    }
  }
  async function submit() {
    const value = new Date(date);
    if(!Number.isFinite(value.getTime())||value.getTime()>Date.now()){mutation.error='Choose a valid listening date in the past.';return;}
    await log(value.toISOString());
  }
  reportFailure(()=>mutation.error);
  reportFailure(()=>choices.error);
</script>
<Dialog bind:open={logOpen} title={logKind==='album' ? 'Log album' : 'Log listen'}>
  <form class="stack" onsubmit={event => { event.preventDefault(); void submit(); }}>
    {#if logKind==='artist'}
      <Field label="Track">
        <select value={selected?.id??''} disabled={choices.busy||mutation.busy} required
          onchange={event=>{selected=choices.data.items.find(item=>item.id===event.currentTarget.value);}}>
          <option value="" disabled>Choose a track</option>
          {#if selected&&!choices.data.items.some(item=>item.id===selected?.id)}<option value={selected.id}>{selected.title}</option>{/if}
          {#each choices.data.items as track (track.id)}<option value={track.id}>{track.title}</option>{/each}
        </select>
      </Field>
      {#if choices.busy}<p class="small quiet" role="status">Loading tracks…</p>{:else if !choices.error&&!choices.data.items.length}<p class="small quiet">No known tracks.</p>{/if}
      {#if number>1||choices.data.hasMore}<div class="inline">
        {#if number>1}<Button disabled={choices.busy||mutation.busy} onclick={()=>{number-=1;}}>Previous tracks</Button>{/if}
        {#if choices.data.hasMore}<Button disabled={choices.busy||mutation.busy} onclick={()=>{number+=1;}}>More tracks</Button>{/if}
      </div>{/if}
    {/if}
    <Field label="Listened at"><input type="datetime-local" bind:value={date} required /></Field>
    <Button type="submit" disabled={mutation.busy||(logKind==='artist'&&!selected)}>Log {logKind==='album' ? 'album' : 'listen'}</Button>
  </form>
</Dialog>
<WorkHistory bind:open={historyOpen} target={target} kind="music" {changed} />
<Dialog bind:open={resetOpen} title="Reset playback position?">
  <p>Clears the saved position for this track. Listening history and saved choices are kept.</p>
  <FormActions>
    <Button disabled={mutation.busy} onclick={()=>{resetOpen=false;}}>Cancel</Button>
    <Button disabled={mutation.busy} onclick={confirmReset}>Reset playback position</Button>
  </FormActions>
</Dialog>
