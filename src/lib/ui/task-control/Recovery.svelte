<script lang="ts">
  import {page} from '$app/state';
  import {untrack,onDestroy} from 'svelte';
  import {useClient,reportFailure} from '#lib/ui/client-context.js';
  import {pendingTaskControl,restoreTaskControl,runTaskControl,abandonTaskControl,taskControlMessage} from '#lib/ui/task-control.svelte.js';
  import type {TaskControlListing,TaskControlCommand} from '#lib/providers/task-control.js';
  import {displayLabel} from '#lib/ui/labels.js';
  import Button from '../components/Button.svelte';
  const {change,feedback,preview}=useClient();
  let {commands}:{commands:TaskControlListing}=$props();
  let busy=$state(false),error=$state(''),request:AbortController|undefined;
  onDestroy(()=>request?.abort());
  const actor=$derived(page.data.user?.id);
  $effect(()=>{const owner=actor;request?.abort();if(owner&&!preview)untrack(()=>restoreTaskControl(owner));});
  const pending=$derived(pendingTaskControl.value?.actorId===actor?pendingTaskControl.value:null);
  const unfinished=$derived(commands.items.filter(item=>item.status==='incomplete'));
  const recent=$derived(commands.items.filter(item=>item.status!=='incomplete'));
  async function control(item:Pick<TaskControlCommand,'id'|'kind'|'instanceId'|'action'>,abandon=false){
    if(busy||!actor||preview)return;
    const owner=actor;busy=true;error='';const controller=new AbortController();request=controller;
    const spec={kind:item.kind,instanceId:item.instanceId,action:item.action};
    const send=(path:string,body:object)=>change<TaskControlCommand>(path,body,'POST',{signal:controller.signal});
    try{
      const result=abandon?await abandonTaskControl(owner,item.id,spec,send,()=>actor===owner&&!controller.signal.aborted):await runTaskControl(owner,spec,send,()=>actor===owner&&!controller.signal.aborted,item.id,()=>controller.abort());
      if(result)feedback.notify(taskControlMessage(result));
    }catch(cause){if(actor===owner&&!controller.signal.aborted)error=cause instanceof Error?cause.message:'The task action could not be updated.';}
    finally{request=undefined;busy=false;}
  }
  reportFailure(()=>error);
</script>
{#if unfinished.length||pending||recent.length}
  <details open={unfinished.length>0||!!pending}>
    <summary>Bulk task actions{#if unfinished.length} · {unfinished.length} unfinished{/if}</summary>
    <div class="stack">
      {#if pending&&pendingTaskControl.pause}<div class="row"><span>Applying task action…</span><Button emphasis="subtle" onclick={()=>pendingTaskControl.pause?.stop()}>Pause</Button></div>{/if}
      {#if pending&&!unfinished.some(item=>item.id===pending.id)}
        <div class="row"><span>{displayLabel(pending.kind)} · awaiting acknowledgement</span><Button emphasis="subtle" disabled={busy||!!pendingTaskControl.pause} onclick={()=>control(pending!)}>Resume</Button><Button emphasis="subtle" disabled={busy||!!pendingTaskControl.pause} onclick={()=>control(pending!,true)}>Abandon</Button></div>
      {/if}
      {#each unfinished as item(item.id)}
        <div class="row"><span>{displayLabel(item.kind)} · {item.action} · {item.updated+item.skipped}/{item.total}{#if item.error} · interrupted{/if}</span><Button emphasis="subtle" disabled={busy||!!pendingTaskControl.pause} onclick={()=>control(item)}>Resume</Button><Button emphasis="subtle" disabled={busy||!!pendingTaskControl.pause} onclick={()=>control(item,true)}>Abandon</Button></div>
      {/each}
      {#if commands.more}<p class="small quiet">Complete or abandon these actions to reveal more unfinished batches.</p>{/if}
      {#if recent.length}<details><summary>Recent results</summary>{#each recent as item(item.id)}<p class="small quiet">{displayLabel(item.kind)} · {taskControlMessage(item)}</p>{/each}</details>{/if}
    </div>
  </details>
{/if}
<style>.row{flex-wrap:wrap;gap:8px}.row span{flex:1;min-width:140px}</style>
