<script lang="ts">
 import {onDestroy,untrack,setContext} from 'svelte';
 import Dialog from './Dialog.svelte';
 import Heading from './Heading.svelte';
 import Button from './Button.svelte';
 import SegmentedControl from './SegmentedControl.svelte';
 import MediaCard from './MediaCard.svelte';
 import EmptyState from './EmptyState.svelte';
 import {createResource} from '#lib/ui/resource.svelte.js';
 import {useClient, reportFailure } from '#lib/ui/client-context.js';
 import {useClock} from '#lib/ui/clock.svelte.js';
 import {activityDateLabel} from '#lib/social/model.js';
 import {playbackTime} from '#lib/playback/time.js';
 import {readingLocationLabel} from '#lib/reading/model.js';
 import type {StreamsSnapshot} from '#lib/application/streams.server.js';
 import type {listActiveShares} from '#lib/sharing/links.server.js';
 type Link = Awaited<ReturnType<typeof listActiveShares>>[number];
 type Stream = StreamsSnapshot['streams'][number];
 type StreamAction = {kind:'revoke'|'stop';id:string;title:string};
 let {open=$bindable(false),onclose,isAdmin=true,initialView='now'}:{
  open:boolean;onclose?:()=>void;isAdmin?:boolean;initialView?:'now'|'history'|'links';
 }=$props();
 const {api,change,preview,feedback:delivery}=useClient();
 setContext('profile-read-only',()=>true);
 let view=$state<string>(untrack(()=>isAdmin?initialView:'links')),refreshing=$state(false);
 let pendingAction=$state<StreamAction|null>(null),acting=$state(false);
 const selectedView=$derived(isAdmin && (view==='now'||view==='history')?view:'links');
 const clock=useClock('minute',()=>open&&selectedView==='history');
 const empty=(view:'now'|'history'):StreamsSnapshot=>({streams:[],issues:[],scanning:false,checkedAt:null,nextCursor:null,view});
 const resource=createResource<StreamsSnapshot>(empty('now'));
 const links=createResource<Link[]>([]);
 const expiration=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
 const visibleStreams=$derived.by(()=>{
  const shown=new Set<string>();
  return resource.data.streams.flatMap(stream=>{
   if(resource.data.view==='history'||!stream.sharing)return [{key:`session:${stream.id}`,stream,grouped:false}];
   const key=`share:${stream.sharing.linkId}`;
   if(shown.has(key))return [];
   shown.add(key);
   return [{key,stream,grouped:stream.sharing.viewers>1}];
  });
 });
 function load(more=false){
  if(selectedView==='links')return links.load(signal=>api('sharing?active=true',undefined,'GET',{signal}));
  const selected=selectedView,before=more?resource.data.nextCursor:null;
  return resource.load(signal=>api(`providers/streams?view=${selected}${before?`&before=${encodeURIComponent(before)}`:''}`,undefined,'GET',{signal}),{
   merge:(previous,result)=>more?{...result,streams:[...previous.streams,...result.streams]}:result
  });
 }
 async function refresh(){
  if(refreshing)return;
  refreshing=true;
  try{
   const {queued,needsAttention,unavailable}=await api<{queued:number;needsAttention:number;unavailable:number}>('providers/streams/refresh',{},'POST');
   if(needsAttention)delivery.failure('A server scan failed. Retry Server streams in Jobs.');
   else if(queued)delivery.notify('Server scan queued.');
   else if(unavailable)delivery.failure('Choose a connected Jellyfin administrator in the Server streams job schedule.');
   else delivery.notify('A server scan is already queued or running.');
   if(open)await load();
  }catch(error){delivery.failure(error instanceof Error?error.message:'Could not queue a server scan.');}
  finally{refreshing=false;}
 }
 function stopPlayback(stream:Stream){
  if(stream.sharing)pendingAction={kind:'stop',id:stream.sharing.linkId,title:stream.title};
 }
 async function confirmAction(){
  const action=pendingAction;
  if(!action||acting)return;
  acting=true;
  try{
   if(action.kind==='revoke'){
    await change(`sharing/${action.id}`,undefined,'DELETE');
    delivery.notify('Link revoked.');
   }else{
    const {stopped}=await api<{stopped:number}>(`sharing/${action.id}/stop`,{},'POST');
    delivery.notify(stopped?'Shared playback stopped.':'No viewers were playing this link.');
   }
   pendingAction=null;
   if(open)await load();
  }catch(error){delivery.failure(error instanceof Error?error.message:'Could not complete this action.');}
  finally{acting=false;}
 }
 $effect(()=>{
  const selected=selectedView;
  if(!open)return;
  const current=selected==='links'?links:resource;
  untrack(()=>{
   if(selected!=='links')resource.replace(empty(selected));
   void load();
  });
  if(preview)return()=>current.cancel();
  const timer=setInterval(()=>{
   if(document.hidden||current.busy)return;
   if(selected==='links'||(selected==='now'||resource.data.scanning)&&!resource.data.nextCursor&&resource.data.streams.length<=20)void load();
  },15000);
  return ()=>{clearInterval(timer);current.cancel();};
 });
 onDestroy(resource.dispose);
 onDestroy(links.dispose);
 reportFailure(()=>open ? selectedView==='links'?links.error:resource.error || resource.data.issues.map(issue=>`${issue.server} · ${issue.message}`).join(' ') : '', ()=>load());
</script>
<Dialog bind:open title={isAdmin?'Active streams':'Shared links'} popover={true} popoverWidth={360} anchor={preview?undefined:"#streams-trigger"} {onclose}>
 {#snippet heading()}
  <Heading title={isAdmin?'Active streams':'Links'}>
   {#snippet heading()}
    {#if isAdmin}<SegmentedControl label="Stream activity" bind:value={view} options={[{value:'now',label:'Now'},{value:'history',label:'History'},{value:'links',label:'Links'}]}/>
    {:else}<h2>Links</h2>{/if}
   {/snippet}
   {#snippet actions()}
    <div class="actions">
     {#if selectedView==='links'}
      <Button size="icon" icon="refresh" label="Refresh links" disabled={links.busy} onclick={()=>void load()}/>
     {:else if isAdmin}
      <Button size="icon" icon="refresh" label="Run server scan" disabled={refreshing} onclick={()=>void refresh()}/>
     {/if}
     <Button size="icon" icon="close" label="Close streams" onclick={()=>{open=false;onclose?.();}}/>
    </div>
   {/snippet}
  </Heading>
 {/snippet}
 {#if selectedView==='links'}
  <div class="streams" aria-busy={links.busy}>
   {#if !links.ready&&links.busy}<div class="skeleton loading" role="status" aria-label="Loading shared links"></div>{/if}
   {#each links.data as link (link.id)}
    <MediaCard item={{...link.card,captionTitle:link.title,captionSubtitle:link.target==='vrchat'?'VRChat':'Website',rating:null}} shape="fanart" artworkStyle="thumb" showPrimaryAction={false} activityProgress={null}>
     {#snippet cornerMenu()}
      <Button item danger disabled={acting} onclick={()=>{pendingAction={kind:'revoke',id:link.id,title:link.title};}}>Revoke link</Button>
     {/snippet}
     {#snippet body()}<p>{link.viewers ? `About ${link.viewers} ${link.viewers===1?'viewer':'viewers'}` : 'No active viewers'}</p>{/snippet}
     {#snippet footer()}<span>Expires <time datetime={link.expiresAt}>{expiration.format(new Date(link.expiresAt))}</time></span>{/snippet}
    </MediaCard>
   {/each}
   {#if links.ready&&!links.busy&&!links.error&&!links.data.length}<div class="full"><EmptyState title="No active links" description="Links appear here until they expire or you revoke them." icon="play"/></div>{/if}
  </div>
 {:else}
 <div class="streams" aria-busy={resource.busy}>

  {#if !resource.data.streams.length&&(resource.busy||resource.data.scanning&&!resource.error)}<div class="skeleton loading" role="status" aria-label="Loading server streams"></div><div class="skeleton loading" aria-hidden="true"></div>{/if}
  {#each visibleStreams as {key,stream,grouped} (key)}
   <MediaCard item={{...stream.card,captionTitle:stream.title,captionActor:stream.actor,captionActivity:undefined,captionSubtitle:[view==='history'?'Ended':grouped?'Shared stream':stream.mediaType==='Book'?'Reading':stream.paused?'Paused':'Playing',stream.episode].filter(Boolean).join(' · ')}} shape="fanart" artworkStyle="thumb" wrapActivity showPrimaryAction={false} activityProgress={grouped?null:stream.progress} footer={grouped?undefined:position} cornerMenu={view==='now'&&stream.sharing?sharedMenu:undefined}>
    {#snippet activityTrailing()}{#if view==='history'}<time datetime={stream.lastSeenAt} title={`Last observed ${new Date(stream.lastSeenAt).toLocaleString()}; first observed ${new Date(stream.firstSeenAt).toLocaleString()}`}>{activityDateLabel(stream.lastSeenAt,clock.now)}</time>{/if}{/snippet}
    {#snippet body()}<p>{(grouped?[stream.server,stream.method]:[stream.server,stream.client,stream.device,stream.method]).filter(Boolean).join(' · ')}</p>
      {#if stream.sharing}<p>{[`Shared by ${stream.sharing.creator}`,`${stream.sharing.estimated?'About ':''}${stream.sharing.viewers} ${stream.sharing.viewers===1?'viewer':'viewers'}`,!grouped&&stream.sharing.bitrateMbps?`${stream.sharing.bitrateMbps} Mbps target`:null].filter(Boolean).join(' · ')}</p>{/if}
    {/snippet}
   </MediaCard>
   {#snippet sharedMenu()}
    <Button item danger disabled={acting} onclick={()=>stopPlayback(stream)}>Stop shared playback</Button>
   {/snippet}
   {#snippet position()}<span>{stream.mediaType==='Book'?readingLocationLabel(stream.reading??null):`${playbackTime(stream.position)}${stream.duration?` / ${playbackTime(stream.duration)}`:''}`}</span>{/snippet}
  {/each}
  {#if resource.ready&&!resource.busy&&!resource.error&&!resource.data.scanning&&!resource.data.streams.length&&!resource.data.issues.length}<div class="full"><EmptyState title={view==='history'?'No recorded sessions':'No active streams'} description={view==='history'?'Sessions appear here after a successful scan confirms they have ended.':'No playback was found in the last server scan.'} icon="play"/></div>{/if}
  {#if resource.data.nextCursor}<div class="full"><Button disabled={resource.busy} onclick={()=>void load(true)}>More</Button></div>{/if}
 </div>
 {/if}
<Dialog open={pendingAction!==null} onclose={()=>{pendingAction=null;}} title={pendingAction?.kind==='revoke'?'Revoke link?':'Stop shared playback?'}>
 {#snippet footer()}
  <Button disabled={acting} onclick={()=>{pendingAction=null;}}>Cancel</Button>
  <Button danger disabled={acting} onclick={()=>void confirmAction()}>{pendingAction?.kind==='revoke'?'Revoke link':'Stop playback'}</Button>
 {/snippet}
 {#if pendingAction}
  <p>{pendingAction.kind==='revoke'? `Viewers will lose access to ${pendingAction.title} through this link.` : `This ends the current viewer sessions for ${pendingAction.title}. Viewers can reopen the link.`}</p>
 {/if}
</Dialog>
</Dialog>
<style>
 .actions{display:flex;gap:8px;}
 .streams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;}
 .full{grid-column:1/-1;}
 .loading{height:140px;border-radius:12px;}
</style>
