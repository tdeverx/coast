<script lang="ts">
 import {statusLabels,type ActivityStatus} from '$lib/social/status';
 import Button from './Button.svelte';
 import Avatar from './Avatar.svelte';
 import IdentityCard from './IdentityCard.svelte';
 import type {FriendEntry} from '$lib/social/model';
 let {friends,userId,busy=false,act,oninvite,inviteDisabled=false}:{oninvite?:(userId:string)=>void;inviteDisabled?:boolean;friends:FriendEntry[];userId:string;busy?:boolean;act:(path:string,body:unknown)=>void}=$props();
</script>
<div class="friend-roster">
  {#each friends as friend (friend.id)}
   <IdentityCard progress={friend.activity?.progress} background={friend.activity?.artwork||friend.backgroundArtwork} wrapActions={friend.state!=='accepted'}>
    {#snippet identity()}<a href={`/profile/${encodeURIComponent(friend.username)}`} aria-label={`${friend.username}'s profile`}><Avatar name={friend.username} src={friend.avatar} size={40} status={friend.state==='accepted'?friend.activityStatus as ActivityStatus:undefined} /></a>{/snippet}
    {#snippet title()}<a href={`/profile/${encodeURIComponent(friend.username)}`}>{friend.username}</a>{/snippet}
    {#snippet details()}{#if friend.state==='accepted'}<p class="small">{#if friend.activity}<a href={friend.activity.href}>{friend.activity.label} · {friend.activity.title}</a>{:else}{statusLabels[friend.activityStatus as ActivityStatus]}{/if}</p>{:else}<p class="small">{friend.requestedBy===userId?'Request sent':'Wants to be friends'}</p>{/if}{/snippet}
    {#snippet actions()}{#if friend.state==='accepted'}<Button menu label={`Actions for ${friend.username}`}><Button item icon="user" href={`/profile/${encodeURIComponent(friend.username)}`}>Profile</Button>{#if friend.canCompare}<Button item icon="heart" href={`/taste/${friend.userId}`}>Taste & overlap</Button>{/if}{#if friend.activity}<Button item icon="play" href={friend.activity.href}>View activity</Button>{/if}{#if oninvite}<Button item icon="party" disabled={busy||inviteDisabled} keepOpen={false} onclick={()=>oninvite?.(friend.userId)}>Invite to party</Button>{/if}<div class="menu-divider" role="separator"></div><Button item danger disabled={busy} keepOpen={false} onclick={()=>act(`social/friends/${friend.id}`,{action:'remove'})}>Remove friend</Button></Button>
   {:else if friend.requestedBy===userId}<Button emphasis="subtle" disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'cancel'})}>Cancel</Button>
   {:else}<Button disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'accept'})}>Accept</Button><Button emphasis="subtle" disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'decline'})}>Decline</Button>{/if}{/snippet}
   </IdentityCard>
  {/each}
</div>

<style>
 .friend-roster{display:grid;gap:12px;}
</style>
