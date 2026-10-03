<script lang="ts">
 import {onDestroy} from 'svelte';
 import {page} from '$app/state';
 import Dialog from './Dialog.svelte';
 import Heading from './Heading.svelte';
 import Button from './Button.svelte';
 import FriendRoster from './FriendRoster.svelte';
 import PartyCard from './PartyCard.svelte';
 import ActivityHeader from './ActivityHeader.svelte';
 import {playbackTime} from '$lib/playback/time';
 import {profilePath} from '$lib/profile/url';
 import SegmentedControl from './SegmentedControl.svelte';
 import PlaybackTimeline from './PlaybackTimeline.svelte';
 import {playbackArtwork} from '$lib/ui/artwork-priority';
 import {timelinePosition} from '$lib/playback/synced/model';
 import type {MediaCardPresentation} from '$lib/ui/types';
 import {useClock} from '$lib/ui/clock.svelte';
 import SyncedControls from './SyncedControls.svelte';
 import {beginPlaybackGesture} from '$lib/playback/client.svelte';
 import {syncedPlayer,startSynced,joinSynced,canInviteToParty} from '$lib/playback/synced/client.svelte';
 import type {RoomState} from '$lib/playback/synced/model';
 import EmptyState from './EmptyState.svelte';
 import {createResource} from '$lib/ui/resource.svelte';
 import {message} from '$lib/ui/client';
 import {useClient} from '$lib/ui/client-context';
 const {api,change,preview}=useClient();
 const clock=useClock();
 import type {FriendEntry} from '$lib/social/model';
 let {open=$bindable(false),onclose}:{open:boolean;onclose?:()=>void}=$props();
 let segment=$state('accepted'),number=$state(1),username=$state(''),busy=$state(false),failure=$state('');
 const partyId=$derived(syncedPlayer.room?.id);
 async function inviteFriend(friendId:string){if(busy||syncedPlayer.busy)return;busy=true;failure='';try{if(!syncedPlayer.room)await startSynced();if(!syncedPlayer.room)throw new Error(syncedPlayer.notice||'Could not create a party.');await change(`synced/${syncedPlayer.room.id}/invite`,{friendId});segment='party';await loadParties();}catch(error){failure=message(error);}finally{busy=false;}}
 const parties=createResource<{id:string;createdAt:string;host:string;hostId:string;joined:boolean;mediaType:'audio'|'video';progress:number|null;durationSeconds:number;positionSeconds:number;paused:boolean;bufferingPaused:boolean;updatedAt:string;playingItem:MediaCardPresentation|null;backgroundArtwork?:string|null;nowPlaying:string|null;participants:{userId:string;username:string;avatar:string|null;joined:boolean}[];friend:FriendEntry|null}[]>([]);
 async function loadParties(){await parties.load(signal=>api('synced',undefined,'GET',{signal}));}
 async function joinParty(id:string){failure='';beginPlaybackGesture(parties.data.find(room=>room.id===id)?.mediaType??'video');try{await joinSynced(await api<RoomState>(`synced/${id}`,undefined,'GET'));await loadParties();}catch(error){failure=message(error);}}
 $effect(()=>{if(open&&segment==='party'){partyId;void loadParties();}});
 const roster=createResource<FriendEntry[]>([]);
 let loadedKey=$state('');
 async function load(){const key=`${segment}:${number}`;const result=await roster.load(async signal=>{const [friends,activity]=await Promise.all([api<FriendEntry[]>(`social/friends?state=${segment}&page=${number}`,undefined,'GET',{signal}),api<{userId:string;title:string;href:string;category:string;artwork?:string;progress:number|null}[]>('social/checkins',undefined,'GET',{signal})]);return friends.map(friend=>{const current=activity.find(item=>item.userId===friend.userId);return {...friend,activity:current?{...current,label:current.category==='music'?'Listening':current.category==='game'?'Playing':'Watching'}:undefined};});});if(result)loadedKey=key;}
 $effect(()=>{if(open&&segment!=='party'){segment;number;void load();}});
 $effect(()=>{if(!open||preview)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!roster.busy&&!busy){if(segment==='party')void loadParties();else void load();}},30000);return()=>clearInterval(timer);});
 onDestroy(()=>{roster.cancel();parties.cancel();});
 async function act(path:string,body:unknown){
  if(busy)return;busy=true;failure='';
  try{await change(path,body);if(path==='social/friends'){username='';segment='pending';number=1;}if(segment==='party')await loadParties();else await load();}
  catch(error){failure=message(error);}finally{busy=false;}
 }
</script>
{#snippet activeParty()}<SyncedControls inline embedded/>{/snippet}
<Dialog bind:open title="Friends" popover={true} anchor="#friends-trigger" {onclose} footer={syncedPlayer.room?activeParty:undefined}>
 {#snippet heading()}<Heading title="Friends">{#snippet heading()}<SegmentedControl label="Friends view" value={segment} options={[{value:'accepted',label:'Friends'},{value:'pending',label:page.data.friendRequestCount?`Requests (${page.data.friendRequestCount})`:'Requests'},...(page.data.experimentalFeatures?[{value:'party',label:'Parties'}]:[])]} onchange={value=>{segment=value;number=1;}}/>{/snippet}
  {#snippet actions()}<div class="header-actions"><Button menu label="Friend options"><Button item icon="refresh" text="Refresh" disabled={busy||roster.busy} keepOpen={false} onclick={()=>void (segment==='party'?loadParties():load())}/><Button item icon="settings" href="/settings/privacy">Privacy & social</Button></Button><Button size="icon" icon="close" label="Close friends" onclick={()=>{open=false;onclose?.();}}/></div>{/snippet}
 </Heading>{/snippet}
 {#if failure||roster.error}<p class="notice error" role="alert">{failure||roster.error}</p><Button emphasis="subtle" onclick={()=>void (segment==='party'?loadParties():load())}>Retry</Button>{/if}
 {#if segment==='party'}
  <div class="party-list">

   {#each parties.data.filter(room=>room.id!==syncedPlayer.room?.id) as room (room.id)}
    {#snippet partyFooter()}<PlaybackTimeline mediaId={room.playingItem?.id} href={room.playingItem?.href} audio={room.mediaType==='audio'} title={room.playingItem?.title??'Idle'} detail={room.playingItem?.captionSubtitle??''} artwork={room.playingItem?playbackArtwork(room.playingItem):undefined} current={room.playingItem?timelinePosition(room,clock.now):0} duration={room.playingItem?room.durationSeconds:0}/>{/snippet}
    {#snippet inviteHeader()}<ActivityHeader username={room.host} avatar={room.participants.find(member=>member.userId===room.hostId)?.avatar}>{#snippet trailing()}<span aria-label="Party duration">{playbackTime(Math.max(0,(clock.now-Date.parse(room.createdAt))/1000))}</span>{/snippet}</ActivityHeader>{/snippet}
    <PartyCard header={room.joined?undefined:inviteHeader} footer={room.playingItem?partyFooter:undefined} members={room.joined?room.participants:[]} background={room.backgroundArtwork}>

     {#snippet memberActions(member)}<Button item icon="user" href={profilePath(member.username)}>Profile</Button>{/snippet}
     {#snippet actions()}{#if room.joined}<span class="small quiet" aria-label="Party duration">{playbackTime(Math.max(0,(clock.now-Date.parse(room.createdAt))/1000))}</span>{/if}{#if !room.joined}<Button size="icon" icon="close" label="Decline invite" title="Decline invite" disabled={busy} onclick={()=>act(`synced/${room.id}/decline`,{})}/>{/if}<Button class="join-action" disabled={syncedPlayer.busy} onclick={()=>joinParty(room.id)}>{room.joined?'Rejoin':'Join'}</Button>{/snippet}
    </PartyCard>
   {/each}
   {#if !syncedPlayer.room}<Button icon="party" disabled={syncedPlayer.busy} onclick={async()=>{await startSynced();await loadParties();}}>Create party</Button>{/if}
   {#if parties.error||(!syncedPlayer.room&&syncedPlayer.notice)}<p class="notice" role="status">{parties.error||syncedPlayer.notice}</p>{/if}
  </div>
 {:else}
 {#if segment==='pending'}<form class="request-form" onsubmit={event=>{event.preventDefault();void act('social/friends',{username});}}><label class="field">Add by username<input bind:value={username} required maxlength="100" autocomplete="off"/></label><Button type="submit" disabled={busy||!username.trim()}>Send request</Button></form>{/if}
 {#if roster.busy&&loadedKey!==`${segment}:${number}`}<div class="loading" aria-label="Loading friends">{#each [0,1,2] as item (item)}<div class="skeleton"></div>{/each}</div>
 {:else if roster.data.length&&loadedKey===`${segment}:${number}`}<FriendRoster friends={roster.data.slice(0,60)} userId={page.data.user!.id} busy={busy||syncedPlayer.busy} {act} oninvite={page.data.experimentalFeatures?inviteFriend:undefined} inviteDisabled={!canInviteToParty()}/>
 {:else if !roster.error}<EmptyState title={segment==='pending'?'No friend requests':'Add your first friend'} description={segment==='pending'?'Incoming and sent requests appear here.':'Exchange usernames in Requests to connect.'} icon="user"/>{/if}
 {#if number>1||roster.data.length>60}<div class="paging"><Button emphasis="subtle" disabled={number===1||roster.busy} onclick={()=>number--}>Previous</Button><span class="small quiet">Page {number}</span><Button emphasis="subtle" disabled={roster.data.length<=60||roster.busy} onclick={()=>number++}>Next</Button></div>{/if}
 {/if}
</Dialog>
<style>
 .party-list{display:grid;gap:12px;}
 .party-list :global(.join-action),.party-list :global(.join-action:hover){color:var(--success);}
 .header-actions{display:flex;align-items:center;gap:0;}
 .request-form{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:0 0 12px;}
 .request-form .field{flex:1;min-width:160px;}
 .paging{margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;}
 .loading{display:grid;gap:12px;}
 .skeleton{height:66px;border-radius:12px;}
</style>
