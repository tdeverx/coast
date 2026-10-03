<script lang="ts">
 import { page } from '$app/state';
 import { replaceState } from '$app/navigation';
 import Dialog from '$lib/ui/components/Dialog.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import Details from '$lib/media/Details.svelte';
 import { api,message } from '$lib/ui/client';
 let open=$state(false),busy=$state(false),error=$state('');
 let data=$state<Awaited<ReturnType<typeof import('$lib/server/queries/media').detailsData>>|null>(null);
 const enabled=$derived(page.data.experiments.mediaModal);
 function closed(){if(!busy&&page.state.mediaModalId)replaceState(page.url,{...page.state,mediaModalId:undefined});}
 $effect(()=>{
  const id=page.state.mediaModalId;
  open=false;data=null;error='';busy=false;
  if(!id||!enabled)return;
  busy=true;
  const controller=new AbortController();
  void api<NonNullable<typeof data>>(`media/${id}`,undefined,'GET',{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted){data=result;busy=false;open=true;}})
   .catch(cause=>{if(!controller.signal.aborted){error=message(cause);busy=false;open=true;}});
  return ()=>controller.abort();
 });

</script>
<Dialog bind:open title="Media details · experimental" wide edgeToEdge onclose={closed}>
 <p class="small muted modal-notice">Experimental modal · visual treatment unapproved</p>
 {#if error}<p class="notice error" role="alert">{error}</p>{/if}
 {#if data}<Details modal data={{...data,requestable:false,refreshUnavailable:false,enhancement:Promise.resolve({...data,requestable:false,refreshUnavailable:false}),experimentalMusic:page.data.experimentalMusic,experimentalGaming:page.data.experimentalGaming,experimentalParties:page.data.experimentalParties,user:page.data.user,contentRevision:page.data.contentRevision,unreadNotifications:page.data.unreadNotifications,friendRequestCount:page.data.friendRequestCount,notifications:page.data.notifications,experiments:page.data.experiments,playbackSharing:page.data.playbackSharing,publicRead:page.data.publicRead,publicProfiles:page.data.publicProfiles,expiresAt:page.data.expiresAt}}/><div class="modal-footer"><Button href={`/media/${data.item.id}`} onclick={()=>open=false}>Full page</Button></div>{/if}
</Dialog>

<style>
 .modal-notice {padding:0 24px 16px;margin:0;}
 .modal-footer {padding:16px 24px;}
</style>
