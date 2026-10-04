<script lang="ts">
 import type {Snippet} from 'svelte';
 import type {ActivityStatus} from '$lib/social/status';
 import Avatar from './Avatar.svelte';
 import {profilePath} from '$lib/profile/url';
 let {username,avatar,status,trailing,nonApproved=false,showAvatar=true}:{username:string;avatar?:string|null;status?:ActivityStatus;trailing?:Snippet;nonApproved?:boolean;showAvatar?:boolean}=$props();
</script>
<div class="activity-header">
 {#if showAvatar}<a class="actor" href={profilePath(username)} aria-label={username} title={nonApproved?`${username} · Non-approved`:username} data-design-status={nonApproved?'non-approved':undefined}><Avatar name={username} src={avatar} {status} size={20}/></a>{:else}<span class="actor-space" aria-hidden="true"></span>{/if}
 <a class="username" href={profilePath(username)}>{username}</a>
 {#if trailing}<span class="small quiet time">{@render trailing()}</span>{/if}
</div>
<style>
 .activity-header{display:flex;align-items:center;gap:6px;font-size:var(--text-md);}
 .actor{flex-shrink:0;}
 .actor-space{width:20px;height:20px;flex-shrink:0;}
 .username{min-width:0;color:var(--ink);font-weight:var(--weight-semibold);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .time{flex-shrink:0;margin-left:auto;}
</style>
