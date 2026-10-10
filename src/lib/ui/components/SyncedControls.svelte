<script lang="ts">
  import {syncedPlayer,startSynced,joinSynced,isSyncHost,syncedCommand,leaveSynced} from '$lib/playback/synced/client.svelte';
  import { useClient } from '$lib/ui/client-context';
  import {timelinePosition} from '$lib/playback/synced/model';
  import {onDestroy} from 'svelte';
  import {createResource} from '$lib/ui/resource.svelte';
  import type {MediaCardPresentation} from '$lib/ui/types';
  import PlaybackTimeline from './PlaybackTimeline.svelte';
  import {playbackArtwork,playbackBackground} from '$lib/media/artwork';
  import {useClock} from '$lib/ui/clock.svelte';
  import {profilePath} from '$lib/profile/url';
  import {playbackTime} from '$lib/playback/time';
  import PartyCard from './PartyCard.svelte';
  import PartyMenu from './PartyMenu.svelte';
  import Dialog from './Dialog.svelte'; import Button from './Button.svelte';

  let {inline=false,embedded=false}:{inline?:boolean;embedded?:boolean}=$props();
  const { preview,api } = useClient();
  const clock=useClock();

  let open=$state(false);
  const media=createResource<MediaCardPresentation|null>(null);
  const members=$derived(syncedPlayer.room?.participants??[]);
  const mediaId=$derived(syncedPlayer.room?.mediaId);
  const roomId=$derived(syncedPlayer.room?.id);
  $effect(()=>{if(mediaId&&roomId){media.replace(null);void media.load(signal=>api(`synced/${roomId}/media`,undefined,'GET',{signal}));}else media.replace(null);});
  onDestroy(media.cancel);
  export async function show(){if(preview)return;open=true;if(!syncedPlayer.room)await startSynced();}
  async function retry(){try{await joinSynced(syncedPlayer.room!);}catch{/* The shared player retains the failure notice. */}}
</script>
{#snippet content()}
  {#if syncedPlayer.room}
    {#snippet partyBody()}
      {#if syncedPlayer.unavailableMediaId}<Button disabled={syncedPlayer.busy} onclick={retry}>{syncedPlayer.room?.mediaType==='reading'?'Retry reading':'Retry playback'}</Button>{/if}
      {#if syncedPlayer.notice}<p class="notice" role="status">{syncedPlayer.notice}</p>{/if}
    {/snippet}
    {#snippet partyFooter()}
      <PlaybackTimeline readingActive={syncedPlayer.room?.mediaType==='reading'} reading={syncedPlayer.room?.reading??null} mediaId={syncedPlayer.room?.mediaId??undefined} href={media.data?.href} audio={syncedPlayer.room?.mediaType==='audio'} title={media.data?.title??'Now playing'} detail={media.data?.captionSubtitle??''} artwork={media.data?playbackArtwork(media.data):undefined} current={mediaId&&syncedPlayer.room?timelinePosition(syncedPlayer.room,clock.now):0} duration={mediaId?syncedPlayer.room?.durationSeconds??0:0}/>
    {/snippet}
    <PartyCard inParty {embedded} footer={mediaId?partyFooter:undefined} {members} children={syncedPlayer.unavailableMediaId||syncedPlayer.notice?partyBody:undefined} label="Current party" background={mediaId&&media.data?playbackBackground(media.data):null}>

      {#snippet memberActions(member)}<Button item icon="user" href={profilePath(member.username)}>Profile</Button>{#if isSyncHost()&&member.userId!==syncedPlayer.room?.hostId}<Button item disabled={syncedPlayer.busy||!member.joined} keepOpen={false} onclick={()=>syncedCommand('promote',{userId:member.userId})}>Promote to owner</Button><div class="menu-divider" role="separator"></div><Button item danger disabled={syncedPlayer.busy} keepOpen={false} onclick={()=>syncedCommand('kick',{userId:member.userId})}>Kick</Button>{/if}{/snippet}
      {#snippet actions()}
        <span class="small quiet" aria-label="Party duration">{playbackTime(Math.max(0,(clock.now-Date.parse(syncedPlayer.room?.createdAt??''))/1000))}</span>
        <Button size="icon" icon="close" label="Leave party" title="Leave party" disabled={syncedPlayer.busy} onclick={async()=>{await leaveSynced();open=false;}}/>
        <PartyMenu/>
      {/snippet}
    </PartyCard>
  {:else if syncedPlayer.notice}<p class="notice" role="status">{syncedPlayer.notice}</p>{/if}
{/snippet}
{#if inline}{@render content()}{:else}<Dialog bind:open title="Party · Experimental">{@render content()}</Dialog>{/if}
