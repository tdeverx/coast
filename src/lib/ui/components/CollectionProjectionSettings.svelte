<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { api,message } from '$lib/ui/client';
  import type { ProjectionConfig,ProjectionPreview } from '$lib/collection/projection.server';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  let {connectionId,settings,sources=[]}:{connectionId:string;settings:Record<string,unknown>;sources?:{id:string;name:string}[]}=$props();
  let config=$state<ProjectionConfig>(untrack(()=>({enabled:false,source:'collected',availableOnly:false,scope:'dynamic',sourceIds:[],...(settings.collectionProjection as Partial<ProjectionConfig>)})));
  let busy=$state(false),failure=$state(''),open=$state(false),preview=$state<ProjectionPreview|null>(null);
  async function prepare(){busy=true;failure='';try{preview=await api(`providers/${connectionId}/collection-preview`,config);open=true;}catch(e){failure=message(e);}finally{busy=false;}}
  async function approve(choice:string){if(!preview)return;busy=true;failure='';try{await api(`providers/${connectionId}/collection-approve`,{previewId:preview.id,choice});open=false;await invalidateAll();}catch(e){failure=message(e);}finally{busy=false;}}
  async function review(workId:string,choice:'remote'|'coast'){if(!preview)return;busy=true;failure='';try{await api(`providers/${connectionId}/collection-review`,{previewId:preview.id,workId,choice});preview={...preview,conflicts:preview.conflicts.filter(e=>e.workId!==workId),uncertain:preview.uncertain.filter(e=>e.workId!==workId)};}catch(e){failure=message(e);}finally{busy=false;}}
</script>
<div class="stack">
  <h3>Export Trakt Collection</h3>
  <label class="check"><input type="checkbox" bind:checked={config.enabled} disabled={busy} />Export selected items to Trakt Collection</label>
  <label class="field">Export source<select bind:value={config.source} disabled={busy}><option value="collected">Collected items</option><option value="personal">All items in my Collection</option><option value="server">All server items</option></select></label>
  {#if config.source!=='server'}<label class="check"><input type="checkbox" bind:checked={config.availableOnly} disabled={busy} />Only export available items</label>{/if}
  {#if config.source==='server'||config.availableOnly}
    <label class="field">Servers<select bind:value={config.scope} disabled={busy}><option value="dynamic">All eligible linked servers</option><option value="fixed">Selected servers</option></select></label>
    {#if config.scope==='fixed'}{#each sources as source}<label class="check"><input type="checkbox" bind:group={config.sourceIds} value={source.id} disabled={busy} />{source.name}</label>{/each}{/if}
  {/if}
  <p class="small">Personal Collection and server availability are separate. This export does not change history, ratings, watchlist or lists.</p>
  <div><Button variant="secondary" disabled={busy} onclick={prepare}>Preview export changes</Button></div>
  {#if failure&&!open}<p class="notice error" role="alert">{failure}</p>{/if}
</div>
<Dialog bind:open title="Trakt Collection preview">
  {#if preview}<div class="stack">
    <p>{preview.additions.length} additions · {preview.removals.length} obsolete entries · {preview.uncertain.length} uncertain · {preview.conflicts.length} conflicts · {preview.unresolved.length} unresolved identities.</p>
    {#if preview.blocked}<p class="notice">Source assessments are incomplete or stale. Removals are blocked until access is verified.</p>{/if}
    {#each [{title:'Additions',items:preview.additions},{title:'Obsolete entries',items:preview.removals},{title:'Uncertain attribution — review required',items:preview.uncertain},{title:'Remote changes — conflicts',items:preview.conflicts}] as group}{#if group.items.length}<div><h3>{group.title}</h3><ul>{#each group.items.slice(0,60) as item}<li>{item.title}</li>{/each}</ul></div>{/if}{/each}
    {#if preview.unresolved.length}<p class="small">Unresolved: {preview.unresolved.slice(0,60).join(', ')}</p>{/if}
    {#each [...preview.conflicts,...preview.uncertain.filter(e=>!preview?.conflicts.some(c=>c.workId===e.workId))] as entry (entry.workId)}<div class="panel stack"><strong>{entry.title}</strong><p class="small">Keep the remote membership as it is, or confirm Coast may manage this entry. Delivery is queued and rechecks the account and remote state.</p><div class="row"><Button variant="secondary" disabled={busy} onclick={()=>review(entry.workId,'remote')}>Keep remote changes</Button><Button variant="ghost" disabled={busy} onclick={()=>review(entry.workId,'coast')}>Use Coast selection</Button></div></div>{/each}
    <p class="small">Managed cleanup removes confirmed Coast additions only. Pre-existing and uncertain entries stay. Replace/Clear all also removes entries created outside Coast.</p>
    {#if failure}<p class="notice error" role="alert">{failure}</p>{/if}
    <div class="row"><Button disabled={busy} onclick={()=>approve('leave')}>Leave existing entries</Button><Button variant="secondary" disabled={busy||preview.blocked} onclick={()=>approve('remove-managed')}>{config.enabled?'Remove obsolete Coast-added entries':'Remove Coast-added entries'}</Button><Button variant="danger" disabled={busy||preview.blocked} onclick={()=>approve(config.enabled?'replace-all':'clear-all')}>{config.enabled?'Replace all':'Clear all'}</Button></div>
  </div>{/if}
</Dialog>
