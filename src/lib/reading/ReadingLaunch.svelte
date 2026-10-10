<script lang="ts">
 import { useClient } from '$lib/ui/client-context';
 import { createOperation } from '$lib/ui/operation.svelte';
 import { openReading, reader } from './client.svelte';
 import Dialog from '$lib/ui/components/Dialog.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import type { ReadingFormat } from './model';
 let {workId,title,compact=false,onopened}:{workId:string;title:string;compact?:boolean;onopened?:()=>Promise<void>}=$props();
 const {api}=useClient(),operation=createOperation();
 let open=$state(false),connections=$state<{id:string;name:string}[]>([]),connectionId=$state(''),query=$state(''),items=$state<{id:string;title:string;format:ReadingFormat|null}[]>([]),offset=$state(0),nextOffset=$state<number|null>(null),searched=$state(false);
 async function show(){if(reader.session?.workId===workId){reader.visible=true;await operation.run(async()=>{await onopened?.();});return;}open=true;searched=false;items=[];query=title;await operation.run(async()=>{connections=await api(`reading/${workId}/connections`,undefined,'GET');connectionId=connections[0]?.id??'';});}
 async function search(next=0){await operation.run(async()=>{const params=new URLSearchParams({connectionId,q:query,offset:String(next)});const result=await api<{items:typeof items;nextOffset:number|null}>(`reading/${workId}/sources?${params}`,undefined,'GET');items=result.items;offset=next;nextOffset=result.nextOffset;searched=true;});}
 async function choose(source:{file:File}|{connectionId:string;externalId:string}){await operation.run(async()=>{await openReading(workId,source);open=false;await onopened?.();});}
</script>
<Button size={compact?undefined:'hero'} {compact} icon="library" onclick={show}>{compact?'Start':'Read'}</Button>
<Dialog bind:open title="Choose a reading edition">
 <div class="stack">
  {#if operation.error}<p class="notice error" role="alert">{operation.error}</p>{/if}
  <label class="field">Open a file<input type="file" accept=".pdf,.epub,.cbz" disabled={operation.busy} onchange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void choose({file});}} /></label>
  <p class="small quiet">PDF, EPUB or CBZ. Local files stay in this browser. Party members need the same edition and their own copy.</p>
  {#if connections.length}
   <form class="stack" onsubmit={event=>{event.preventDefault();void search();}}>
    <label class="field">Jellyfin server<select bind:value={connectionId} onchange={()=>{items=[];searched=false;}}>{#each connections as connection}<option value={connection.id}>{connection.name}</option>{/each}</select></label>
    <label class="field">Find your edition<input bind:value={query} maxlength="250" /></label>
    <Button type="submit" disabled={operation.busy}>Search</Button>
   </form>
   {#each items as item (item.id)}<div class="spread"><span>{item.title} <small class="quiet">{item.format?.toUpperCase()??'Unsupported format'}</small></span><Button disabled={!item.format||operation.busy} onclick={()=>void choose({connectionId,externalId:item.id})}>Read</Button></div>{/each}
   {#if searched&&!items.length}<p class="quiet">No reading files found.</p>{/if}
   <div class="row">{#if offset>0}<Button disabled={operation.busy} onclick={()=>void search(Math.max(0,offset-60))}>Previous</Button>{/if}{#if nextOffset!==null}<Button disabled={operation.busy} onclick={()=>void search(nextOffset!)}>Next</Button>{/if}</div>
  {/if}
 </div>
</Dialog>
