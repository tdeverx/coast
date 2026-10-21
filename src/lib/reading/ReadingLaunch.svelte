<script lang="ts">
 import { onDestroy, untrack } from 'svelte';
 import { useRetention } from '#lib/ui/retention.js';
 import { useClient, reportFailure } from '#lib/ui/client-context.js';
 import { createOperation } from '#lib/ui/operation.svelte.js';
 import { openReading, reader } from './client.svelte';
 import Button from '#lib/ui/components/Button.svelte';
 let {workId,compact=false,hideTrigger=false,onopened}:{workId:string;compact?:boolean;hideTrigger?:boolean;onopened?:()=>Promise<void>}=$props();
 const {preview}=useClient(),operation=createOperation(useRetention());
 let target='',opening:AbortController|undefined;
 export function isBusy(){return operation.busy;}
 function cancel(){opening?.abort();opening=undefined;}
 $effect(()=>{const id=workId;untrack(()=>{if(target&&id!==target)cancel();});});
 onDestroy(cancel);
 export async function show(){
  if(preview||operation.busy)return;
  cancel();target=workId;const id=target,controller=new AbortController();opening=controller;
  await operation.run(async()=>{
   if(reader.session?.workId===id)reader.visible=true;
   else await openReading(id,undefined,controller.signal);
   if(!controller.signal.aborted&&id===workId)await onopened?.();
  });
  if(opening===controller)opening=undefined;
 }
 reportFailure(()=>operation.error);
</script>
{#if !hideTrigger}<Button size={compact?undefined:'hero'} {compact} icon="library" disabled={operation.busy||preview} onclick={show}>{!preview&&reader.session?.workId===workId?'Continue reading':'Read'}</Button>{/if}
