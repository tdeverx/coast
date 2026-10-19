<script lang="ts">
 import {onDestroy,untrack,setContext} from 'svelte';
 import Dialog from './Dialog.svelte';
 import Heading from './Heading.svelte';
 import Button from './Button.svelte';
 import SegmentedControl from './SegmentedControl.svelte';
 import MediaCard from './MediaCard.svelte';
 import EmptyState from './EmptyState.svelte';
 import {createResource} from '$lib/ui/resource.svelte';
 import {useClient, reportFailure } from '$lib/ui/client-context';
 import {useClock} from '$lib/ui/clock.svelte';
 import {activityDateLabel} from '$lib/social/model';
 import {playbackTime} from '$lib/playback/time';
 import {readingLocationLabel} from '$lib/reading/model';
 import type {StreamsSnapshot} from '$lib/application/streams.server';
 let {open=$bindable(false),onclose,initialView='now'}:{open:boolean;onclose?:()=>void;initialView?:'now'|'history'}=$props();
 const {api,preview,feedback:delivery}=useClient();
 setContext('profile-read-only',()=>true);
 let view=$state<string>(untrack(()=>initialView)),refreshing=$state(false);
 const clock=useClock('minute',()=>open&&view==='history');
 const empty=(view:'now'|'history'):StreamsSnapshot=>({streams:[],issues:[],checkedAt:null,nextCursor:null,view});
 const resource=createResource<StreamsSnapshot>(empty('now'));
 function load(more=false){const selected=view;const before=more?resource.data.nextCursor:null;return resource.load(signal=>api(`providers/streams?view=${selected}${before?`&before=${encodeURIComponent(before)}`:''}`,undefined,'GET',{signal}),{merge:(previous,result)=>more?{...result,streams:[...previous.streams,...result.streams]}:result});}
 async function refresh(){if(refreshing)return;refreshing=true;try{const result=await api<{queued:number;needsAttention:number;unavailable:number}>('providers/streams/refresh',{},'POST');const text=result.needsAttention?'A server scan failed. Retry Server streams in Jobs.':result.queued?'Server scan queued.':result.unavailable?'Choose a connected Jellyfin administrator in the Server streams job schedule.':'A server scan is already queued or running.';if(result.needsAttention||result.unavailable)delivery.failure(text);else delivery.notify(text);await load();}catch(error){delivery.failure(error instanceof Error?error.message:'Could not queue a server scan.');}finally{refreshing=false;}}
 $effect(()=>{
  const selected=view;if(!open){resource.cancel();return;}
  untrack(()=>{resource.replace(empty(selected as 'now'|'history'));void load();});
  if(preview)return()=>resource.cancel();
  const timer=setInterval(()=>{if(!document.hidden&&!resource.busy&&selected==='now'&&!resource.data.nextCursor&&resource.data.streams.length<=20)void load();},15000);
  return ()=>{clearInterval(timer);resource.cancel();};
 });
 onDestroy(resource.dispose);
  reportFailure(()=>resource.error || resource.data.issues.map(issue=>`${issue.server} · ${issue.message}`).join(' '), ()=>load());
</script>
<Dialog bind:open title="Active streams" popover={true} popoverWidth={360} anchor={preview?undefined:"#streams-trigger"} {onclose}>
 {#snippet heading()}<Heading title="Active streams">{#snippet heading()}<SegmentedControl label="Server streams" bind:value={view} options={[{value:'now',label:'Now'},{value:'history',label:'History'}]}/>{/snippet}{#snippet actions()}<div class="actions"><Button size="icon" icon="refresh" label="Run server scan" disabled={refreshing} onclick={()=>void refresh()}/><Button size="icon" icon="close" label="Close streams" onclick={()=>{open=false;onclose?.();}}/></div>{/snippet}</Heading>{/snippet}
 <div class="streams" aria-busy={resource.busy}>

  {#if !resource.data.streams.length&&resource.busy}<div class="skeleton loading" role="status" aria-label="Loading server streams"></div><div class="skeleton loading" aria-hidden="true"></div>{/if}
  {#each resource.data.streams as stream (stream.id)}
   <MediaCard item={{...stream.card,captionTitle:stream.title,captionActor:stream.actor,captionActivity:undefined,captionSubtitle:[view==='history'?'Ended':stream.mediaType==='Book'?'Reading':stream.paused?'Paused':'Playing',stream.episode].filter(Boolean).join(' · ')}} shape="fanart" artworkStyle="thumb" wrapActivity showPrimaryAction={false} activityProgress={stream.progress}>
    {#snippet activityTrailing()}{#if view==='history'}<time datetime={stream.lastSeenAt} title={`Last observed ${new Date(stream.lastSeenAt).toLocaleString()}; first observed ${new Date(stream.firstSeenAt).toLocaleString()}`}>{activityDateLabel(stream.lastSeenAt,clock.now)}</time>{/if}{/snippet}
    {#snippet body()}<p>{[stream.server,stream.client,stream.device,stream.method].filter(Boolean).join(' · ')}</p>
      {#if stream.sharing}<p>{[`Shared by ${stream.sharing.creator}`,`${stream.sharing.estimated?'About ':''}${stream.sharing.viewers} ${stream.sharing.viewers===1?'viewer':'viewers'}`,stream.sharing.bitrateMbps?`${stream.sharing.bitrateMbps} Mbps target`:null].filter(Boolean).join(' · ')}</p>{/if}
    {/snippet}
    {#snippet footer()}<span>{stream.mediaType==='Book'?readingLocationLabel(stream.reading??null):`${playbackTime(stream.position)}${stream.duration?` / ${playbackTime(stream.duration)}`:''}`}</span>{/snippet}
   </MediaCard>
  {/each}
  {#if resource.ready&&!resource.busy&&!resource.data.streams.length&&!resource.data.issues.length}<div class="full"><EmptyState title={view==='history'?'No recorded sessions':'No active streams'} description={view==='history'?'Sessions appear here after a successful scan confirms they have ended.':'No playback was found in the last server scan.'} icon="play"/></div>{/if}
  {#if resource.data.nextCursor}<div class="full"><Button disabled={resource.busy} onclick={()=>void load(true)}>More</Button></div>{/if}
 </div>
</Dialog>
<style>.actions{display:flex;gap:8px;}.streams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;}.full{grid-column:1/-1;}.loading{height:140px;border-radius:12px;}</style>
