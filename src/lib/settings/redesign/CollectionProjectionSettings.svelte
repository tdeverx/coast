<script lang="ts">
  import SettingsChoice from '#lib/settings/SettingsChoice.svelte';
  import SettingsSwitch from '#lib/settings/SettingsSwitch.svelte';
  import { reportFailure } from '#lib/ui/client-context.js';
  import { untrack } from 'svelte';
  import { message } from '#lib/ui/client.js';
  import { useClient } from '#lib/ui/client-context.js';
  import type { ProjectionConfig,ProjectionPreview } from '#lib/collection/projection.server.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';

  const { change } = useClient();

  let {connectionId,settings,sources=[]}:{connectionId:string;settings:Record<string,unknown>;sources?:{id:string;name:string}[]}=$props();
  let config=$state<ProjectionConfig>(untrack(()=>({enabled:false,source:'collected',availableOnly:false,scope:'dynamic',sourceIds:[],...(settings.collectionProjection as Partial<ProjectionConfig>)})));
  let busy=$state(false),failure=$state(''),open=$state(false),preview=$state<ProjectionPreview|null>(null);
  const blockedReason = 'Source assessments are incomplete or stale. Removals are blocked until access is verified.';
  const reviewEntries=$derived.by(()=>{
    if(!preview)return [];
    const conflictIds=new Set(preview.conflicts.map(entry=>entry.workId));
    return [...preview.conflicts,...preview.uncertain.filter(entry=>!conflictIds.has(entry.workId))];
  });
  async function prepare(){busy=true;failure='';try{preview=await change(`providers/${connectionId}/collection-preview`,config);open=true;}catch(e){failure=message(e);}finally{busy=false;}}
  async function approve(choice:string){if(!preview)return;busy=true;failure='';try{await change(`providers/${connectionId}/collection-approve`,{previewId:preview.id,choice});open=false;}catch(e){failure=message(e);}finally{busy=false;}}
  async function review(workId:string,choice:'remote'|'coast'){if(!preview)return;busy=true;failure='';try{await change(`providers/${connectionId}/collection-review`,{previewId:preview.id,workId,choice});preview={...preview,conflicts:preview.conflicts.filter(e=>e.workId!==workId),uncertain:preview.uncertain.filter(e=>e.workId!==workId)};}catch(e){failure=message(e);}finally{busy=false;}}

  reportFailure(()=>failure || (open && preview?.blocked ? blockedReason : ''));
</script>
<div class="stack">
  <h3>Export Trakt Collection</h3>
  <SettingsSwitch label="Export selected items to Trakt Collection" bind:checked={config.enabled} disabled={busy} />
  <SettingsChoice label="Export source" icon="collection" bind:value={config.source} disabled={busy}
    options={[{ id: 'collected', label: 'Collected items' }, { id: 'personal', label: 'All items in my Collection' },
      { id: 'server', label: 'All server items' }]} />
  {#if config.source!=='server'}<SettingsSwitch label="Only export available items" bind:checked={config.availableOnly} disabled={busy} />{/if}
  {#if config.source==='server'||config.availableOnly}
    <SettingsChoice label="Servers" icon="server" bind:value={config.scope} disabled={busy}
      options={[{ id: 'dynamic', label: 'All eligible linked servers' }, { id: 'fixed', label: 'Selected servers' }]} />
    {#if config.scope==='fixed'}{#each sources as source}<label class="check"><input type="checkbox" bind:group={config.sourceIds} value={source.id} disabled={busy} />{source.name}</label>{/each}{/if}
  {/if}
  <p class="small">Personal Collection and server availability are separate. This export does not change history, ratings, watchlist or lists.</p>
  <div><Button  disabled={busy} onclick={prepare}>Preview export changes</Button></div>

</div>
<Dialog bind:open title="Trakt Collection preview">
  {#if preview}<div class="stack">
    <p>{preview.additions.length} additions · {preview.removals.length} obsolete entries · {preview.uncertain.length} uncertain · {preview.conflicts.length} conflicts · {preview.unresolved.length} unresolved identities.</p>
    {#each [{title:'Additions',items:preview.additions},{title:'Obsolete entries',items:preview.removals},{title:'Uncertain attribution — review required',items:preview.uncertain},{title:'Remote changes — conflicts',items:preview.conflicts}] as group}{#if group.items.length}<div><h3>{group.title}</h3><ul>{#each group.items.slice(0,60) as item}<li>{item.title}</li>{/each}</ul></div>{/if}{/each}
    {#if preview.unresolved.length}<p class="small">Unresolved: {preview.unresolved.slice(0,60).join(', ')}</p>{/if}
    {#each reviewEntries as entry (entry.workId)}<div class="panel stack"><strong>{entry.title}</strong><p class="small">Keep the remote membership as it is, or confirm Coast may manage this entry. Delivery is queued and rechecks the account and remote state.</p><div class="row"><Button  disabled={busy} onclick={()=>review(entry.workId,'remote')}>Keep remote changes</Button><Button emphasis="subtle" disabled={busy} onclick={()=>review(entry.workId,'coast')}>Use Coast selection</Button></div></div>{/each}
    <p class="small">Managed cleanup removes confirmed Coast additions only. Pre-existing and uncertain entries stay. Replace/Clear all also removes entries created outside Coast.</p>

    <div class="row"><Button disabled={busy} onclick={()=>approve('leave')}>Leave existing entries</Button><Button disabled={busy||preview.blocked} disabledReason={preview.blocked ? blockedReason : undefined} onclick={()=>approve('remove-managed')}>{config.enabled?'Remove obsolete Coast-added entries':'Remove Coast-added entries'}</Button><Button danger disabled={busy||preview.blocked} disabledReason={preview.blocked ? blockedReason : undefined} onclick={()=>approve(config.enabled?'replace-all':'clear-all')}>{config.enabled?'Replace all':'Clear all'}</Button></div>
  </div>{/if}
</Dialog>
