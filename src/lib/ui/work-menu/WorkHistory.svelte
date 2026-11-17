<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { reportFailure, useClient } from '../client-context';
  import { createMenuResource } from '../controls/menu-resource.svelte';
  import { retryMenuRead } from '../controls/menu-read-retry';
  import { workMenuScope } from '../controls/work.svelte';
  import { displayLabel } from '../labels';
  import { createMutation } from '../mutation.svelte';
  import { useRetention } from '../retention';
  import Button from '../components/Button.svelte';
  import Dialog from '../components/Dialog.svelte';
  import FormActions from '../components/FormActions.svelte';
  import Pagination from '../components/Pagination.svelte';

  let { open=$bindable(false), target, kind, changed }: {
    open?:boolean; target:string; kind:'reading'|'game'|'music'; changed:()=>Promise<unknown>;
  }=$props();
  type Entry={id:string;title:string;occurredAt:string;note?:string|null;source?:string;dateKnown?:boolean};
  type Page={items:Entry[];page:number;pages:number;total:number};
  let number=$state(1), removal=$state<{kind:typeof kind;target:string;entry:Entry}>();
  const {api,change}=useClient();
  const history=createMenuResource<Page>(()=>({items:[],page:1,pages:1,total:0}),()=>workMenuScope([kind,target,number]),async signal=>{
    if(kind==='music')return api<Page>(`music/${target}/history?page=${number}`,undefined,'GET',{signal});
    if(kind==='reading'){
      const page=await api<{items:{id:string;state:string;page:number;totalPages:number|null;occurredAt:string}[];page:number;pages:number;total:number}>(`reading/${target}/history?page=${number}`,undefined,'GET',{signal});
      return {...page,items:page.items.map(entry=>({id:entry.id,title:`${displayLabel(entry.state)}${entry.page?` · Page ${entry.page}${entry.totalPages?` of ${entry.totalPages}`:''}`:''}`,occurredAt:entry.occurredAt}))};
    }
    const page=await api<{sessions:{id:string;minutesPlayed:number;playedAt:string;note:string|null}[];page:number;pages:number;total:number}>(`game-playthroughs/${target}?page=${number}`,undefined,'GET',{signal});
    return {items:page.sessions.map(entry=>({id:entry.id,title:`${entry.minutesPlayed} minutes played`,occurredAt:entry.playedAt,note:entry.note})),page:page.page,pages:page.pages,total:page.total};
  },retryMenuRead);
  const mutation=createMutation(async()=>{await history.refresh();await changed();},useClient().feedback.notify,useRetention());
  $effect(()=>{
    const active=open,scope=workMenuScope([kind,target,number]);
    untrack(()=>{history.sync(scope);if(active&&target){if(!mutation.busy){void history.refresh();void history.open();}}else history.close();});
  });
  $effect(()=>{if(!open)untrack(()=>{number=1;removal=undefined;});});
  onDestroy(history.dispose);
  async function remove(){
    const selected=removal;
    if(!selected)return;
    const path=selected.kind==='game'?`game-playthroughs/${selected.target}/sessions/${selected.entry.id}`:`${selected.kind}/${selected.target}/history/${selected.entry.id}`;
    if(await mutation.run(()=>change(path,{},'DELETE'),'History entry removed. Current progress is preserved.'))removal=undefined;
  }
  reportFailure(()=>history.error||mutation.error);
</script>
<Dialog bind:open title={kind==='reading'?'Reading history':kind==='music'?'Listening history':'Play sessions'}>
  <div class="stack">
    {#each history.data.items as entry(entry.id)}
      <div class="row">
        <div class="grow"><strong>{entry.title}</strong><div class="small quiet">{entry.dateKnown===false?'Date unknown':new Date(entry.occurredAt).toLocaleString()}{#if entry.source} · {displayLabel(entry.source)}{/if}</div>{#if entry.note}<p class="small">{entry.note}</p>{/if}</div>
        <Button icon="close" label="Remove history entry" disabled={mutation.busy||history.busy} onclick={()=>{removal={kind,target,entry};}} />
      </div>
    {/each}
    {#if history.busy}<p class="small quiet" role="status">Loading history…</p>{:else if !history.error&&!history.data.items.length}<p class="quiet">No history yet.</p>{/if}
    <Pagination page={history.data.page} pages={history.data.pages} busy={history.busy||mutation.busy} label="History pages" onchange={value=>{number=value;}} />
  </div>
</Dialog>
<Dialog open={!!removal} title="Remove history entry?" onclose={()=>{removal=undefined;}}>
  <p>Removes this entry from your Coast history. Current status and position are kept.{#if removal?.kind==='music'} Connected services are unchanged.{/if}</p>
  <FormActions>
    <Button disabled={mutation.busy} onclick={()=>{removal=undefined;}}>Cancel</Button>
    <Button danger disabled={mutation.busy} onclick={remove}>Remove entry</Button>
  </FormActions>
</Dialog>
