<script lang="ts">
 import { onDestroy, untrack } from 'svelte';
 import { useClient } from '$lib/ui/client-context';
 import { createOperation } from '$lib/ui/operation.svelte';
 import { createResource } from '$lib/ui/resource.svelte';
 import { openReading, reader } from './client.svelte';
 import Dialog from '$lib/ui/components/Dialog.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import Field from '$lib/ui/components/Field.svelte';
 import {readingFileAccept,readingFileLabel,type ReadingFormat} from './model';
 let {workId,title,compact=false,hideTrigger=false,onopened}:{workId:string;title:string;compact?:boolean;hideTrigger?:boolean;onopened?:()=>Promise<void>}=$props();
 const {api,preview}=useClient(),operation=createOperation();
 type Linked={connectionId:string;externalId:string;name:string;format:string|null};
 const resource=createResource<{connections:{id:string;name:string}[];linked:Linked[];items:{id:string;title:string;format:ReadingFormat|null}[];nextOffset:number|null}>({connections:[],linked:[],items:[],nextOffset:null});
 let open=$state(false),connectionId=$state(''),query=$state(''),offset=$state(0),searched=$state(false),target='',opening:AbortController|undefined;
 const connections=$derived(resource.data.connections),items=$derived(resource.data.items),nextOffset=$derived(resource.data.nextOffset);
 const busy=$derived(resource.busy||operation.busy);
 export function isBusy(){return busy;}
 function cancel(){resource.cancel();opening?.abort();opening=undefined;}
 $effect(()=>{const id=workId;untrack(()=>{if(target&&id!==target){cancel();open=false;resource.replace({connections:[],linked:[],items:[],nextOffset:null});}});});
 onDestroy(()=>{cancel();resource.dispose();});
 export async function show(){
  if(!preview&&reader.session?.workId===workId){reader.visible=true;await operation.run(async()=>{await onopened?.();});return;}
  cancel();target=workId;const id=target;open=true;searched=false;offset=0;query=title;operation.error='';
  resource.replace({connections:[],linked:[],items:[],nextOffset:null});
  const result=await resource.load(async signal=>{const [connections,linked]=await Promise.all([
   api<{id:string;name:string}[]>(`reading/${id}/connections`,undefined,'GET',{signal}),
   preview?Promise.resolve([]):api<Linked[]>(`reading/${id}/linked`,undefined,'GET',{signal}),
  ]);return {connections,linked,items:[],nextOffset:null};});
  if(!result||!open||target!==workId)return;
  connectionId=result.connections[0]?.id??'';
  if(!preview&&result.linked.length===1)await choose(result.linked[0]);
 }
 async function search(next=0){
  const id=workId,source=connectionId,params=new URLSearchParams({connectionId:source,q:query,offset:String(next)});
  const result=await resource.load(async signal=>({...resource.data,...await api<{items:typeof items;nextOffset:number|null}>(`reading/${id}/sources?${params}`,undefined,'GET',{signal})}));
  if(result){offset=next;searched=true;}
 }
 async function choose(source:{file:File}|{connectionId:string;externalId:string}){
  opening?.abort();const controller=new AbortController();opening=controller;const id=workId;
  await operation.run(async()=>{if(!preview)await openReading(id,source,controller.signal);if(controller.signal.aborted||id!==workId)return;open=false;if(!preview)await onopened?.();});
  if(opening===controller)opening=undefined;
 }
</script>
{#if !hideTrigger}<Button size={compact?undefined:'hero'} {compact} icon="library" disabled={busy} onclick={show}>{!preview&&reader.session?.workId===workId?'Continue reading':'Read'}</Button>{/if}
<Dialog bind:open title="Choose a reading edition" onclose={cancel}>
 <div class="stack">
  {#if resource.error}<p class="notice error" role="alert">{resource.error}</p>{/if}
  {#if resource.busy}<p class="small quiet" role="status">Checking reading sources…</p>{/if}
  {#if resource.data.linked.length>1}{#each resource.data.linked as linked}<div class="spread"><span>{linked.name} · {linked.format?.toUpperCase()}</span><Button disabled={busy} onclick={()=>void choose(linked)}>Read</Button></div>{/each}{/if}
  {#if operation.error}<p class="notice error" role="alert">{operation.error}</p>{/if}
  <label class="field">Open a file<input type="file" accept={readingFileAccept} disabled={busy} onchange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void choose({file});}} /></label>
  <p class="small quiet">{readingFileLabel}. Local files stay in this browser. Party members need the same edition and their own copy.</p>
  {#if connections.length}
   <form class="stack" onsubmit={event=>{event.preventDefault();void search();}}>
    <label class="field">Jellyfin server<select bind:value={connectionId} onchange={()=>{resource.replace({...resource.data,items:[],nextOffset:null});offset=0;searched=false;}}>{#each connections as connection}<option value={connection.id}>{connection.name}</option>{/each}</select></label>
    <Field label="Link another edition"><input bind:value={query} maxlength="250" /></Field>
    <Button type="submit" disabled={busy}>Search</Button>
   </form>
   {#each items as item (item.id)}<div class="spread"><span>{item.title} <small class="quiet">{item.format?.toUpperCase()??'Unsupported format'}</small></span><Button disabled={!item.format||busy} onclick={()=>void choose({connectionId,externalId:item.id})}>Read</Button></div>{/each}
   {#if searched&&!items.length}<p class="quiet">No reading files found.</p>{/if}
   <div class="row">{#if offset>0}<Button disabled={busy} onclick={()=>void search(Math.max(0,offset-60))}>Previous</Button>{/if}{#if nextOffset!==null}<Button disabled={busy} onclick={()=>void search(nextOffset!)}>Next</Button>{/if}</div>
  {/if}
 </div>
</Dialog>
