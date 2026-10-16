<script lang="ts">
  import type { Snippet } from 'svelte';
  let {title,description,reason,details,children}:{title:string;description?:string;reason?:string;details?:Snippet;children:Snippet}=$props();
</script>
<div class="setting">
  <div class="setting-copy"><h3>{title}</h3>{#if description}<p>{description}</p>{/if}{#if reason}<p class="small muted">{reason}</p>{/if}{@render details?.()}</div>
  <div class="setting-control">{@render children()}</div>
</div>
<style>
  .setting {display:flex;align-items:center;gap:28px;padding:0 0 16px;border-bottom:1px solid var(--line);}
  .setting:last-child {padding-bottom:0;border-bottom:0;}
  .setting-copy {flex:1;min-width:0;}
  .setting-control {flex:none;}
  h3,p {font-size:var(--text-sm);}
  p {margin-top:6px;line-height:var(--leading-relaxed);}
  @media(max-width:800px) {.setting {gap:16px;}}
</style>
