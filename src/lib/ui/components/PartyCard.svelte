<script lang="ts">
 import type {Snippet} from 'svelte';
 import MediaCard from './MediaCard.svelte';
 import {profilePath} from '$lib/profile/url';
 type PartyMember={userId?:string;username:string;avatar?:string|null;joined?:boolean};
 let {background,header,actions,children,footer,label,members=[],inParty=false,embedded=false,memberActions}:{background?:string|null;header?:Snippet;actions?:Snippet;children?:Snippet;footer?:Snippet;label?:string;inParty?:boolean;embedded?:boolean;members?:PartyMember[];memberActions?:Snippet<[PartyMember]>}=$props();
</script>
<section class="party-card" class:embedded aria-label={label}>
 {#if header}<div class="invite-header"><div class="context-header">{@render header()}</div>{#if actions}<div class="invite-actions">{@render actions()}</div>{/if}</div>{/if}
 {#if children}<div class="body stack">{@render children()}</div>{/if}
 <div class="playback-area">
  {#if members.length||actions&&!header}<div class="participants-actions">
   {#if members.length}<div class="avatar-slot"><div class="members" aria-label="Party participants">
    {#each members as member (member.userId??member.username)}{#snippet memberControl()}{@render memberActions?.(member)}{/snippet}<div class="member" title={member.joined===false?`${member.username} · Pending`:member.username}><div class:pending={member.joined===false}><MediaCard shape="circle" showCaption={false} showPrimaryAction={false} primaryMenu={memberActions?memberControl:undefined} item={{id:member.userId??member.username,kind:'person',title:member.username,poster:member.avatar,href:profilePath(member.username)}}/></div></div>{/each}
   </div></div>{/if}
   {#if actions&&!header}<div class="header-actions">{@render actions()}</div>{/if}
  </div>{/if}
  {#if footer}<div class="footer-layout" class:has-separator={inParty}>
   {#if background}<img class="background" src={background} alt="" loading="lazy"/>{/if}
   {@render footer()}
  </div>{/if}
 </div>
</section>
<style>
 .party-card{position:relative;isolation:isolate;overflow:visible;border:1px solid var(--line);border-radius:12px;background:var(--surface);--card-padding:8px;--avatar-size:80px;--avatar-overflow:80px;padding:var(--card-padding);display:grid;gap:var(--card-padding);}
 .party-card.embedded{border:0;border-radius:0;background:transparent;}
 .embedded .footer-layout{border-radius:0;}
 .invite-header{display:flex;align-items:center;gap:var(--card-padding);min-width:0;}
 .context-header{flex:1;min-width:0;}
 .invite-actions{display:flex;align-items:center;gap:var(--card-padding);flex:none;}
 .playback-area{position:relative;isolation:isolate;margin:0 calc(-1 * var(--card-padding)) calc(-1 * var(--card-padding));padding:0 var(--card-padding);min-width:0;clip-path:inset(calc(-1 * var(--avatar-overflow)) 0 0);}
 .participants-actions{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--card-padding);padding-bottom:var(--card-padding);min-width:0;}
 .avatar-slot{grid-column:1;grid-row:1;position:relative;align-self:start;height:0;min-width:0;}
 .header-actions{position:relative;z-index:2;grid-column:2;grid-row:1;display:flex;align-items:center;gap:var(--card-padding);}
 .footer-layout{position:relative;isolation:isolate;overflow:hidden;background:var(--surface);margin:0 calc(-1 * var(--card-padding));padding:var(--card-padding);z-index:1;border-radius:0 0 11px 11px;}
 .has-separator{border-top:1px solid var(--line);}
 .background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25;z-index:-1;}
 .member{position:relative;min-width:0;transition:transform 360ms cubic-bezier(.22,1.4,.36,1);}
 .member:is(:hover,:focus-within){transform:translateY(-20px);}
 @media(prefers-reduced-motion:reduce){.member{transition:none;}}
 .pending :global(.art-link){filter:grayscale(1);}
 .members{position:absolute;top:calc(-1 * var(--avatar-overflow));left:0;right:0;display:grid;grid-auto-flow:column;grid-auto-columns:var(--avatar-size);gap:var(--card-padding);overflow-x:auto;overscroll-behavior-x:contain;padding:var(--avatar-overflow) var(--card-padding) var(--card-padding);margin:0 calc(-1 * var(--card-padding));scroll-padding-inline:var(--card-padding);min-width:0;}
</style>
