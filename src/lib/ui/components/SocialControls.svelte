<script lang="ts">
 import type {ActivityStatus} from '$lib/social/status';
 import Avatar from './Avatar.svelte';
 let {friends=[],total=friends.length,showOverflow=true,size=32}:{size?:number;showOverflow?:boolean;friends:{username:string;avatar?:string|null;status?:ActivityStatus}[];total?:number}=$props();
 const visibleFriends=$derived(friends.slice(0,3));
</script>
<div class="friend-heads" style:--head-size={`${size}px`} aria-label="Friends with a relationship to this media">
 {#each visibleFriends as friend}<a class="friend-avatar" href={`/profile/${encodeURIComponent(friend.username)}`} title={friend.username} aria-label={`${friend.username} has a relationship with this media`}><Avatar {size} name={friend.username} src={friend.avatar} status={friend.status} /></a>{/each}
 {#if showOverflow&&total>visibleFriends.length}<span class="small quiet">+{total-visibleFriends.length}</span>{/if}
</div>
<style>
.friend-heads{display:flex;align-items:center;gap:0;flex:none}
.friend-avatar :global(.status-dot){left:0;right:auto}
.friend-avatar+.friend-avatar{margin-left:calc(var(--head-size) / -2)}
.friend-heads>span{margin-left:6px}
.friend-avatar{position:relative;display:grid;place-items:center;width:var(--head-size);height:var(--head-size);border-radius:50%;background:var(--surface);border:1px solid var(--line);font-size:var(--text-sm);color:var(--ink)}

</style>
