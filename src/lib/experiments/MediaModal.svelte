<script lang="ts">
 import {player} from '$lib/playback/client.svelte';
 import {reader} from '$lib/reading/client.svelte';
 import {playbackVisible} from '$lib/playback/visibility';
 import { page } from '$app/state';
 import { replaceState } from '$app/navigation';
 import Dialog from '$lib/ui/components/Dialog.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import ReadingDetails from '$lib/reading/Details.svelte';
 import type { ReadingDetailData } from '$lib/reading/presentation';
 import Details from '$lib/media/Details.svelte';
 import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
 import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
 import { api,message } from '$lib/ui/client';
 let open=$state(false),error=$state('');
 let loadedId:string|undefined;
 let data=$state.raw<Awaited<ReturnType<typeof import('$lib/server/queries/media').detailsData>>|{reading:ReadingDetailData}|null>(null);
 type EnhancedDetails=Awaited<Awaited<ReturnType<typeof import('$lib/application/media-details.server').loadMediaDetails>>['enhancement']>;
 let enhancement=$state.raw<Promise<EnhancedDetails>>();
 const enabled=$derived(page.data.experiments.mediaModal);
 const refreshKey=$derived(contentRevisionKey(page.data,['tracking']));
 function closed(){if(playbackVisible(player)||reader.visible)return;if(page.state.mediaModalId)replaceState(page.url,{...page.state,mediaModalId:undefined});}
 $effect(()=>{
  const id=page.state.mediaModalId;
  if(!id||!enabled||id!==loadedId){open=false;data=null;}
  loadedId=id;error='';
  if(!id||!enabled)return;
  refreshKey;
  const controller=new AbortController();
  void api<NonNullable<typeof data>>(`media/${id}`,undefined,'GET',{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted){data=result;if(!('reading' in result))enhancement=api<Awaited<NonNullable<typeof enhancement>>>(`media/${id}?enhance=true`,undefined,'GET',{signal:controller.signal}).catch(()=>({...result,requestable:false,refreshUnavailable:true}));open=true;}})
   .catch(cause=>{if(!controller.signal.aborted){data=null;error=message(cause);open=true;}});
  return ()=>controller.abort();
 });

</script>
<Dialog open={open&&!playbackVisible(player)&&!reader.visible} title="Media details" wide edgeToEdge onclose={closed}>
 <RowFeedback {error} inline={false} />
 {#if data}{#if 'reading' in data}<ReadingDetails data={data.reading} /><div class="modal-footer"><Button href={`/media/${data.reading.item.id}`} onclick={()=>open=false}>Full page</Button></div>{:else}<Details modal data={{...data,requestable:false,refreshUnavailable:false,enhancement:enhancement!,experimentalMusic:page.data.experimentalMusic,experimentalGaming:page.data.experimentalGaming,experimentalParties:page.data.experimentalParties,experimentalBooks:page.data.experimentalBooks,experimentalComics:page.data.experimentalComics,user:page.data.user,contentRevision:page.data.contentRevision,unreadNotifications:page.data.unreadNotifications,friendRequestCount:page.data.friendRequestCount,notifications:page.data.notifications,experiments:page.data.experiments,playbackSharing:page.data.playbackSharing,publicRead:page.data.publicRead,publicProfiles:page.data.publicProfiles,developerMode:page.data.developerMode,expiresAt:page.data.expiresAt}}/><div class="modal-footer"><Button href={`/media/${data.item.id}`} onclick={()=>open=false}>Full page</Button></div>{/if}{/if}
</Dialog>

<style>
 .modal-footer {padding:16px 24px;}
</style>
