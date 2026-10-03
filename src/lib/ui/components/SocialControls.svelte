<script lang="ts">
 import type {ActivityStatus} from '$lib/social/status';
 import Avatar from './Avatar.svelte';
 import Button from './Button.svelte';
 import {emojis} from '$lib/social/model';
 let {friends=[],total=friends.length,reaction=null,onreact=()=>{},showReactions=true,showLabel=true,context='media',showOverflow=true,size=context==='party'?40:32}:{size?:number;context?:'media'|'party';showOverflow?:boolean;friends:{username:string;avatar?:string|null;status?:ActivityStatus}[];total?:number;reaction?:typeof emojis[number]|null;onreact?:(emoji:typeof emojis[number]|null)=>void;showReactions?:boolean;showLabel?:boolean}=$props();
 const visibleFriends=$derived(context==='party'?friends:friends.slice(0,3));
</script>
{#if showLabel}<p class="small quiet">Non-approved · Social avatar and reaction treatment</p>{/if}
<div class="friend-heads" class:scrolling={context==='party'} style:--head-size={`${size}px`} aria-label={context==='party'?'Party participants':'Friends with a relationship to this media · Non-approved'} title={context==='party'?'Party participants':'Non-approved friend indicators'}>
 {#each visibleFriends as friend}<a class="friend-avatar" href={`/profile/${encodeURIComponent(friend.username)}`} title={context==='party'?friend.username:`${friend.username} has a relationship with this media · Non-approved`} aria-label={context==='party'?friend.username:`${friend.username} has a relationship with this media`}><Avatar {size} name={friend.username} src={friend.avatar} status={friend.status} /></a>{/each}
 {#if showOverflow&&total>visibleFriends.length}<span class="small quiet">+{total-visibleFriends.length}</span>{/if}
</div>
{#if showReactions}<div class="row" aria-label="React to this media">{#each emojis as emoji}<Button emphasis={reaction===emoji ? "standard" : "subtle"} pressed={reaction===emoji} onclick={()=>onreact(reaction===emoji?null:emoji)}>{emoji}</Button>{/each}</div>{/if}
<style>
.friend-heads{display:flex;align-items:center;gap:0;flex:none}
.friend-heads.scrolling{overflow-x:auto;overscroll-behavior-x:contain;gap:8px;padding:2px 0;max-width:100%;}
.scrolling .friend-avatar{flex:none;}
.scrolling .friend-avatar+.friend-avatar{margin-left:0;}
.friend-avatar :global(.status-dot){left:0;right:auto}
.friend-avatar+.friend-avatar{margin-left:calc(var(--head-size) / -2)}
.friend-heads>span{margin-left:6px}
.friend-avatar{position:relative;display:grid;place-items:center;width:var(--head-size);height:var(--head-size);border-radius:50%;background:var(--surface);border:1px solid var(--line);font-size:var(--text-sm);color:var(--ink)}

</style>
