<script lang="ts">
 import Button from './Button.svelte';
 import {emojis} from '$lib/social/model';
 let {friends=[],total=friends.length,reaction=null,onreact=()=>{},showReactions=true,showLabel=true}:{friends:{username:string;avatar?:string|null}[];total?:number;reaction?:typeof emojis[number]|null;onreact?:(emoji:typeof emojis[number]|null)=>void;showReactions?:boolean;showLabel?:boolean}=$props();
</script>
{#if showLabel}<p class="small quiet">Non-approved · Social avatar and reaction treatment</p>{/if}
<div class="friend-heads" aria-label="Friends with a relationship to this media · Non-approved" title="Non-approved friend indicators">
 {#each friends.slice(0,3) as friend}<a class="friend-avatar" href={`/profile/${encodeURIComponent(friend.username)}`} title={`${friend.username} has a relationship with this media · Non-approved`} aria-label={`${friend.username} has a relationship with this media`}>{#if friend.avatar}<img src={friend.avatar} alt="" />{:else}{friend.username.slice(0,1).toUpperCase()}{/if}</a>{/each}
 {#if total>3}<span class="small quiet">+{total-3}</span>{/if}
</div>
{#if showReactions}<div class="row" aria-label="React to this media">{#each emojis as emoji}<Button variant={reaction===emoji?'secondary':'ghost'} onclick={()=>onreact(reaction===emoji?null:emoji)}>{emoji}</Button>{/each}</div>{/if}
<style>
.friend-heads{display:flex;align-items:center;gap:0}
.friend-avatar+.friend-avatar{margin-left:-16px}
.friend-heads>span{margin-left:6px}
.friend-avatar{position:relative;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--surface);border:1px solid var(--line);overflow:hidden;font-size:var(--text-sm);color:var(--ink)}
.friend-avatar img{width:100%;height:100%;object-fit:cover}
</style>
