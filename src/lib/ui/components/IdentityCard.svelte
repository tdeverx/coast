<script lang="ts">
 import type {Snippet} from 'svelte';
 import ProgressBar from './ProgressBar.svelte';
 let {background,identity,title,details,actions,label,progress,wrapActions=false}:{background?:string|null;identity?:Snippet;title:Snippet;details?:Snippet;actions?:Snippet;label?:string;progress?:number|null;wrapActions?:boolean}=$props();
</script>
<section class="identity-card" class:has-progress={progress!=null&&Number.isFinite(progress)} class:wrap-actions={wrapActions} aria-label={label}>
 {#if background}<img class="background" src={background} alt="" loading="lazy"/>{/if}
 <div class="header">
  <div class="identity">{#if identity}<div class="avatar">{@render identity()}</div>{/if}<div class="metadata"><div class="title">{@render title()}</div>{#if details}<div class="details">{@render details()}</div>{/if}</div></div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
 </div>
 {#if progress!=null&&Number.isFinite(progress)}
  <div class="progress"><ProgressBar {progress}/></div>
 {/if}
</section>
<style>
 .identity-card{position:relative;isolation:isolate;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:12px;display:grid;gap:12px;}
 .background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25;z-index:-1;}
 .header{display:flex;align-items:center;justify-content:space-between;gap:12px;}
 .identity{display:flex;align-items:center;gap:12px;min-width:0;flex:1;}
 .avatar,.actions{flex:none;}
 .metadata{min-width:0;overflow-wrap:anywhere;}
 .title{font-weight:var(--weight-semibold);color:var(--ink);}
 .title :global(a){color:inherit;}
 .details{margin-top:4px;}
 .details :global(p){margin:0;overflow-wrap:anywhere;}
 .actions{display:flex;align-items:center;gap:4px;}
 .has-progress{padding-bottom:28px;}
 .progress{position:absolute;bottom:10px;left:10px;right:10px;height:8px;pointer-events:none;}
 @media(max-width:479px){.wrap-actions .header{flex-wrap:wrap;}.wrap-actions .actions{margin-left:auto;}}
</style>
