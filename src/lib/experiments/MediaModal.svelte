<script lang="ts">
 import { page } from '$app/state';
 import { replaceState } from '$app/navigation';
 import Dialog from '$lib/ui/components/Dialog.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import Details from '$lib/media/Details.svelte';
 import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
 import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
 import { api,message } from '$lib/ui/client';
 let open=$state(false),error=$state('');
 let loadedId:string|undefined;
 let data=$state.raw<Awaited<ReturnType<typeof import('$lib/server/queries/media').detailsData>>|null>(null);
 type EnhancedDetails=Awaited<Awaited<ReturnType<typeof import('$lib/application/media-details.server').loadMediaDetails>>['enhancement']>;
 let enhancement=$state.raw<Promise<EnhancedDetails>>();
 const enabled=$derived(page.data.experiments.mediaModal);
 const refreshKey=$derived(contentRevisionKey(page.data,['tracking']));
 function closed(){if(page.state.mediaModalId)replaceState(page.url,{...page.state,mediaModalId:undefined});}
 $effect(()=>{
  const id=page.state.mediaModalId;
  if(!id||!enabled||id!==loadedId){open=false;data=null;}
  loadedId=id;error='';
  if(!id||!enabled)return;
  refreshKey;
  const controller=new AbortController();
  void api<NonNullable<typeof data>>(`media/${id}`,undefined,'GET',{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted){data=result;enhancement=api<Awaited<NonNullable<typeof enhancement>>>(`media/${id}?enhance=true`,undefined,'GET',{signal:controller.signal}).catch(()=>({...result,requestable:false,refreshUnavailable:true}));open=true;}})
   .catch(cause=>{if(!controller.signal.aborted){data=null;error=message(cause);open=true;}});
  return ()=>controller.abort();
 });

</script>
<Dialog bind:open title="Media details" wide edgeToEdge onclose={closed}>
 <RowFeedback {error} inline={false} />
 {#if data}<Details modal data={{...data,requestable:false,refreshUnavailable:false,enhancement:enhancement!,experimentalMusic:page.data.experimentalMusic,experimentalGaming:page.data.experimentalGaming,experimentalParties:page.data.experimentalParties,user:page.data.user,contentRevision:page.data.contentRevision,unreadNotifications:page.data.unreadNotifications,friendRequestCount:page.data.friendRequestCount,notifications:page.data.notifications,experiments:page.data.experiments,playbackSharing:page.data.playbackSharing,publicRead:page.data.publicRead,publicProfiles:page.data.publicProfiles,expiresAt:page.data.expiresAt}}/><div class="modal-footer"><Button href={`/media/${data.item.id}`} onclick={()=>open=false}>Full page</Button></div>{/if}
</Dialog>

<style>
 .modal-footer {padding:16px 24px;}
</style>
