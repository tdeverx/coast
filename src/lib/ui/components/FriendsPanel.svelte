<script lang="ts">
 import {onDestroy,untrack} from 'svelte';
 import {page} from '$app/state';
 import Dialog from './Dialog.svelte';
 import Heading from './Heading.svelte';
 import Button from './Button.svelte';
 import MemberInvites from '#lib/auth/ui/MemberInvites.svelte';
 import FriendRoster from './FriendRoster.svelte';
 import PartyCard from './PartyCard.svelte';
 import ActivityHeader from './ActivityHeader.svelte';
 import {playbackTime} from '#lib/playback/time.js';
 import {profilePath} from '#lib/profile/url.js';
 import SegmentedControl from './SegmentedControl.svelte';
 import PlaybackTimeline from './PlaybackTimeline.svelte';
 import {playbackArtwork} from '#lib/media/artwork.js';
 import {timelinePosition} from '#lib/playback/synced/model.js';
 import type {MediaCardPresentation} from '#lib/ui/types.js';
 import {useClock} from '#lib/ui/clock.svelte.js';
 import SyncedControls from './SyncedControls.svelte';
 import {beginPlaybackGesture} from '#lib/playback/client.svelte.js';
 import {syncedPlayer,startSynced,joinSynced,canInviteToParty} from '#lib/playback/synced/client.svelte.js';
 import type {RoomState} from '#lib/playback/synced/model.js';
 import EmptyState from './EmptyState.svelte';
 import {createResource} from '#lib/ui/resource.svelte.js';
 import {message} from '#lib/ui/client.js';
 import {useClient, reportFailure } from '#lib/ui/client-context.js';
 const {api,change,preview}=useClient();
 const clock=useClock('second',()=>!preview&&open&&activeSegment==='party');
 import type {FriendEntry} from '#lib/social/model.js';
 let {open=$bindable(false),onclose,initialView='accepted'}:{open:boolean;onclose?:()=>void;initialView?:'accepted'|'pending'|'party'}=$props();
 const restricted=$derived(page.data.user?.access?.libraryOnly===true);
 let segment=$state<string>(untrack(()=>initialView)),number=$state(1),username=$state(''),busy=$state(false),failure=$state('');
 const activeSegment=$derived(restricted?'invites':segment);
 // Preview panels never observe the signed-in user's party or call its controller.
 const activeRoom=$derived(preview?null:syncedPlayer.room);
 const partyBusy=$derived(!preview&&syncedPlayer.busy);
 const partyId=$derived(activeRoom?.id);
 async function inviteFriend(friendId:string){if(preview){failure='Party invitations are disabled in this panel example. Use the Party card examples to inspect their states.';return;}if(busy||syncedPlayer.busy)return;busy=true;failure='';try{if(!syncedPlayer.room)await startSynced();if(!syncedPlayer.room)throw new Error(syncedPlayer.notice||'Could not create a party.');await change(`synced/${syncedPlayer.room.id}/invite`,{friendId});if(segment==='party')await loadParties();else segment='party';}catch(error){failure=message(error);}finally{busy=false;}}
 const parties=createResource<{id:string;createdAt:string;host:string;hostId:string;joined:boolean;mediaType:'audio'|'video'|'reading';reading?:RoomState['reading'];progress:number|null;durationSeconds:number;positionSeconds:number;paused:boolean;bufferingPaused:boolean;updatedAt:string;playingItem:MediaCardPresentation|null;backgroundArtwork?:string|null;nowPlaying:string|null;participants:{userId:string;username:string;avatar:string|null;joined:boolean}[];friend:FriendEntry|null}[]>([]);
 async function loadParties(){
  if(!open||activeSegment!=='party'||parties.busy)return;
  await parties.load(signal=>api('synced',undefined,'GET',{signal}));
 }
 async function joinParty(id:string){if(preview){failure='Joining is disabled in this panel example. Use the Party card examples to inspect joined states.';return;}failure='';const type=parties.data.find(room=>room.id===id)?.mediaType;if(type!=='reading')beginPlaybackGesture(type??'video');try{await joinSynced(await api<RoomState>(`synced/${id}`,undefined,'GET'));await loadParties();}catch(error){failure=message(error);}}
 $effect(()=>{
  if(!open||activeSegment!=='party')return;
  partyId;
  untrack(()=>void loadParties());
  return parties.cancel;
 });
 const roster=createResource<FriendEntry[]>([]);
 let loadedKey=$state('');
 const rosterLoading=$derived(open&&loadedKey!==`${activeSegment}:${number}`&&!roster.error);
 const refreshing=$derived(activeSegment==='party'?parties.busy:roster.busy);
 async function loadRoster(){
  const state=activeSegment;
  if(!open||(state!=='accepted'&&state!=='pending')||roster.busy)return;
  const pageNumber=number;
  const result=await roster.load(async signal=>{
   const friends=api<FriendEntry[]>(`social/friends?state=${state}&page=${pageNumber}`,undefined,'GET',{signal});
   if(state==='pending')return friends;
   const [currentFriends,activity]=await Promise.all([
    friends,
    api<{userId:string;title:string;href:string;category:string;source?:string;artwork?:string;progress:number|null}[]>('social/checkins',undefined,'GET',{signal}),
   ]);
   const byUser=new Map<string,(typeof activity)[number]>();
   for(const item of activity)if(!byUser.has(item.userId))byUser.set(item.userId,item);
   return currentFriends.map(friend=>{
    const current=byUser.get(friend.userId);
    if(!current)return {...friend,activity:undefined};
    const label=current.source==='vrchat-share'?'VRChat share (estimated)':current.source==='share'?'Watching via shared link':
      current.category==='music'?'Listening':current.category==='game'?'Playing':['book','comic'].includes(current.category)?'Reading':'Watching';
    return {...friend,activity:{...current,label}};
   });
  });
  if(result&&open&&state===activeSegment&&pageNumber===number)loadedKey=`${state}:${pageNumber}`;
 }
 function refresh(){
  return activeSegment==='party'?loadParties():loadRoster();
 }
 $effect(()=>{
  if(!open||(activeSegment!=='accepted'&&activeSegment!=='pending'))return;
  number;
  untrack(()=>void loadRoster());
  return roster.cancel;
 });
 $effect(()=>{
  if(!open||preview||activeSegment==='invites')return;
  const timer=setInterval(()=>{
   if(!document.hidden&&!busy&&!refreshing)void refresh();
  },30000);
  return ()=>clearInterval(timer);
 });
 onDestroy(()=>{roster.dispose();parties.dispose();});
 async function act(path:string,body:unknown){
  if(busy)return;busy=true;failure='';
  try{
   await change(path,body);
   if(path==='social/friends'){
    username='';
    if(segment!=='pending'||number!==1){
     segment='pending';
     number=1;
     return;
    }
   }
   await refresh();
  }catch(error){failure=message(error);}finally{busy=false;}
 }
 reportFailure(()=>failure || (open ? activeSegment==='party' ? parties.error : activeSegment==='invites' ? '' : roster.error : ''),refresh);
</script>
{#snippet activeParty()}<SyncedControls embedded/>{/snippet}
<Dialog bind:open title={restricted?"Invite people":"Friends"} popover={true} anchor={preview?undefined:"#friends-trigger"} {onclose} footer={activeRoom?activeParty:undefined}>
 {#snippet heading()}<Heading title={restricted?"Invite people":"Friends"}>
  {#snippet heading()}{#if !restricted}<SegmentedControl label="Friends view" value={segment} options={[{value:'accepted',label:'Friends'},{value:'pending',label:page.data.friendRequestCount?`Requests (${page.data.friendRequestCount})`:'Requests'},...(page.data.experimentalParties?[{value:'party',label:'Parties'}]:[]),...(!preview?[{value:'invites',label:'Invite people'}]:[])]} onchange={value=>{segment=value;number=1;}}/>{/if}{/snippet}
  {#snippet actions()}<div class="header-actions">
   {#if !restricted}<Button menu label="Friend options"><Button item icon="refresh" text="Refresh" disabled={busy||refreshing||segment==='invites'} keepOpen={false} onclick={()=>void refresh()}/><Button item icon="settings" href="/settings/privacy">Privacy & social</Button></Button>{/if}
   <Button size="icon" icon="close" label={restricted?"Close invite panel":"Close friends"} onclick={()=>{open=false;onclose?.();}}/>
  </div>{/snippet}
 </Heading>{/snippet}

 {#if open&&activeSegment==='invites'}<MemberInvites />
 {:else if activeSegment==='party'}
  <div class="party-list">

   {#each parties.data.filter(room=>room.id!==activeRoom?.id) as room (room.id)}
    {#snippet partyFooter()}<PlaybackTimeline readingActive={room.mediaType==='reading'} reading={room.reading??null} mediaId={room.playingItem?.id} href={room.playingItem?.href} audio={room.mediaType==='audio'} title={room.playingItem?.title??'Idle'} detail={room.playingItem?.captionSubtitle??''} artwork={room.playingItem?playbackArtwork(room.playingItem):undefined} current={room.playingItem?timelinePosition(room,clock.now):0} duration={room.playingItem?room.durationSeconds:0}/>{/snippet}
    {#snippet inviteHeader()}<ActivityHeader username={room.host} avatar={room.participants.find(member=>member.userId===room.hostId)?.avatar}>{#snippet trailing()}<span aria-label="Party duration">{playbackTime(Math.max(0,(clock.now-Date.parse(room.createdAt))/1000))}</span>{/snippet}</ActivityHeader>{/snippet}
    <PartyCard header={room.joined?undefined:inviteHeader} footer={room.playingItem?partyFooter:undefined} members={room.joined?room.participants:[]} background={room.backgroundArtwork}>

     {#snippet memberActions(member)}<Button item icon="user" href={profilePath(member.username)}>Profile</Button>{/snippet}
     {#snippet actions()}{#if room.joined}<span class="small quiet" aria-label="Party duration">{playbackTime(Math.max(0,(clock.now-Date.parse(room.createdAt))/1000))}</span>{/if}{#if !room.joined}<Button size="icon" icon="close" label="Decline invite" title="Decline invite" disabled={busy} onclick={()=>act(`synced/${room.id}/decline`,{})}/>{/if}<Button class="join-action" disabled={partyBusy} onclick={()=>joinParty(room.id)}>{room.joined?'Rejoin':'Join'}</Button>{/snippet}
    </PartyCard>
   {/each}
   {#if !activeRoom}<Button icon="party" disabled={preview||partyBusy} title={preview?'Creating a party is disabled in this preview':undefined} onclick={async()=>{if(preview)return;await startSynced();}}>Create party</Button>{/if}

  </div>
 {:else}
 {#if segment==='pending'}<form class="request-form" onsubmit={event=>{event.preventDefault();void act('social/friends',{username});}}><label class="field">Add by username<input bind:value={username} required maxlength="100" autocomplete="off"/></label><Button type="submit" disabled={busy||!username.trim()}>Send request</Button></form>{/if}
 {#if rosterLoading}
  <div class="loading">
   <span class="sr-only" role="status">{segment==='pending'?'Loading friend requests…':'Loading friends…'}</span>
   {#each [0,1,2] as item (item)}
    <div class="friend-placeholder" aria-hidden="true">
     <span class="skeleton skeleton-circle avatar-placeholder"></span>
     <div class="placeholder-copy">
      <span class="skeleton skeleton-line name-placeholder"></span>
      <span class="skeleton skeleton-line status-placeholder"></span>
     </div>
     <span class="skeleton skeleton-circle action-placeholder"></span>
    </div>
   {/each}
  </div>
 {:else if roster.data.length&&loadedKey===`${segment}:${number}`}<FriendRoster friends={roster.data.slice(0,60)} userId={page.data.user!.id} busy={busy||partyBusy} {act} oninvite={page.data.experimentalParties?inviteFriend:undefined} inviteDisabled={preview||!canInviteToParty()}/>
 {:else if !roster.error}<EmptyState title={segment==='pending'?'No friend requests':'Add your first friend'} description={segment==='pending'?'Incoming and sent requests appear here.':'Exchange usernames in Requests to connect.'} icon="user"/>{/if}
 {#if number>1||loadedKey===`${activeSegment}:${number}`&&roster.data.length>60}<div class="paging"><Button emphasis="subtle" disabled={number===1||roster.busy} onclick={()=>number--}>Previous</Button><span class="small quiet">Page {number}</span><Button emphasis="subtle" disabled={loadedKey!==`${activeSegment}:${number}`||roster.data.length<=60||roster.busy} onclick={()=>number++}>Next</Button></div>{/if}
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
 .friend-placeholder{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:12px;}
 .placeholder-copy{display:grid;gap:4px;flex:1;min-width:0;}
 .avatar-placeholder{width:40px;}
 .name-placeholder{width:min(65%,160px);height:calc(var(--text-md) * var(--leading-normal));}
 .status-placeholder{width:min(45%,110px);height:calc(var(--text-sm) * var(--leading-normal));}
 .action-placeholder{width:var(--control-height);}
</style>
