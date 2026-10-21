<script lang="ts">
  import {syncedPlayer,startSynced,joinSynced,isSyncHost,syncedCommand,leaveSynced} from '#lib/playback/synced/client.svelte.js';
  import { useClient } from '#lib/ui/client-context.js';
  import {timelinePosition} from '#lib/playback/synced/model.js';
  import {onDestroy} from 'svelte';
  import {createResource} from '#lib/ui/resource.svelte.js';
  import type {MediaCardPresentation} from '#lib/ui/types.js';
  import PlaybackTimeline from './PlaybackTimeline.svelte';
  import {playbackArtwork,playbackBackground} from '#lib/media/artwork.js';
  import {useClock} from '#lib/ui/clock.svelte.js';
  import {profilePath} from '#lib/profile/url.js';
  import {playbackTime} from '#lib/playback/time.js';
  import PartyCard from './PartyCard.svelte';
  import PartyMenu from './PartyMenu.svelte';
  import Dialog from './Dialog.svelte'; import Button from './Button.svelte';

  let {inline=false,embedded=false}:{inline?:boolean;embedded?:boolean}=$props();
  const { preview,api } = useClient();
  const clock=useClock('second',()=>!preview&&(inline||open)&&!!room);

  let open=$state(false);
  const media=createResource<MediaCardPresentation|null>(null);
  // Rich party examples use PartyCard props; never borrow a live party for preview.
  const room=$derived(preview?null:syncedPlayer.room);
  const unavailableMediaId=$derived(preview?null:syncedPlayer.unavailableMediaId);
  const busy=$derived(!preview&&syncedPlayer.busy);
  const members=$derived(room?.participants??[]);
  const mediaId=$derived(room?.mediaId);
  const roomId=$derived(room?.id);
  $effect(()=>{if(mediaId&&roomId){media.replace(null);void media.load(signal=>api(`synced/${roomId}/media`,undefined,'GET',{signal}));}else media.replace(null);});
  onDestroy(media.dispose);
  export async function show(){if(preview)return;open=true;if(!syncedPlayer.room)await startSynced();}
  async function retry(){if(preview||!room)return;try{await joinSynced(room);}catch{/* The shared player retains the failure notice. */}}
</script>
{#snippet content()}
  {#if room}
    {#snippet partyBody()}
      {#if unavailableMediaId}<Button disabled={busy} onclick={retry}>{room?.mediaType==='reading'?'Retry reading':'Retry playback'}</Button>{/if}

    {/snippet}
    {#snippet partyFooter()}
      <PlaybackTimeline readingActive={room?.mediaType==='reading'} reading={room?.reading??null} mediaId={room?.mediaId??undefined} href={media.data?.href} audio={room?.mediaType==='audio'} title={media.data?.title??'Now playing'} detail={media.data?.captionSubtitle??''} artwork={media.data?playbackArtwork(media.data):undefined} current={mediaId&&room?timelinePosition(room,clock.now):0} duration={mediaId?room?.durationSeconds??0:0}/>
    {/snippet}
    <PartyCard inParty {embedded} footer={mediaId?partyFooter:undefined} {members} children={unavailableMediaId?partyBody:undefined} label="Current party" background={mediaId&&media.data?playbackBackground(media.data):null}>

      {#snippet memberActions(member)}<Button item icon="user" href={profilePath(member.username)}>Profile</Button>{#if !preview&&isSyncHost()&&member.userId!==room?.hostId}<Button item disabled={busy||!member.joined} keepOpen={false} onclick={()=>syncedCommand('promote',{userId:member.userId})}>Promote to owner</Button><div class="menu-divider" role="separator"></div><Button item danger disabled={busy} keepOpen={false} onclick={()=>syncedCommand('kick',{userId:member.userId})}>Kick</Button>{/if}{/snippet}
      {#snippet actions()}
        <span class="small quiet" aria-label="Party duration">{playbackTime(Math.max(0,(clock.now-Date.parse(room?.createdAt??''))/1000))}</span>
        <Button size="icon" icon="close" label="Leave party" title="Leave party" disabled={busy} onclick={async()=>{if(preview)return;await leaveSynced();open=false;}}/>
        <PartyMenu/>
      {/snippet}
    </PartyCard>
  {/if}
{/snippet}
{#if inline}{@render content()}{:else}<Dialog bind:open title="Party · Experimental">{@render content()}</Dialog>{/if}
