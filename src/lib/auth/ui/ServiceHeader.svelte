<script lang="ts">
  import type { Snippet } from 'svelte';
  import AuthSurface from './AuthSurface.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  let {provider,note,expanded,controls,username='',onactivate,trailing,activateLabel,activationUrl,id}:{
    provider:'jellyfin'|'trakt'; note:string; expanded?:boolean; controls?:string; username?:string;
    onactivate?:()=>void; trailing?:Snippet; activateLabel?:string; activationUrl?:string; id?:string;
  }=$props();
  const name=$derived(provider==='jellyfin'?'Jellyfin':'Trakt');
</script>
{#snippet content()}
  <Icon name={provider} size={16}/>
  <span class="row-label" class:approval-status={!!trailing} role={trailing?'status':undefined}>{#if activationUrl}<a href={activationUrl} target="_blank" rel="noreferrer" title="Open Trakt’s activation page">{activateLabel}</a>{:else}{activateLabel ?? name}{/if}</span>
  {#if !trailing}
    <span class="menu-row-note" title={username ? `Connected as ${username}` : undefined}>{note}{#if username}<span class="sr-only"> as {username}</span>{/if}</span>
    {#if onactivate}<span class="chevron" class:expanded class:muted={expanded===undefined}><Icon name="right" size={16}/></span>{/if}
  {/if}
{/snippet}
<div class="service-header" class:jellyfin={provider==='jellyfin'}><AuthSurface>
  <div class:pairing={!!trailing}>
    <h2 {id}>
      {#if onactivate}
        <button class="menu-row" type="button" aria-controls={controls} aria-expanded={expanded} onclick={onactivate}>{@render content()}</button>
      {:else}<span class="menu-row summary">{@render content()}</span>{/if}
    </h2>
    {@render trailing?.()}
  </div>
</AuthSurface></div>
<style>
  h2 { margin:0; }
  .service-header { --tint:var(--trakt-purple); --end:var(--trakt-purple); --strength:36%; }
  .jellyfin { --tint:var(--jellyfin-purple); --end:var(--jellyfin-blue); }
  .service-header:has(button.menu-row:is(:hover,:focus-visible)) { --strength:53%; }
  .service-header :global(.credential-fields) { background-image:linear-gradient(115deg,color-mix(in srgb,var(--tint) var(--strength),transparent),color-mix(in srgb,var(--end) var(--strength),transparent)); }
  .pairing { display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--menu-inset); }
  .row-label { flex:1;min-width:0; }
  .approval-status a { color:inherit; text-decoration:inherit; }
  .chevron { display:inline-flex;transition:transform var(--motion) var(--ease); }
  .expanded { transform:rotate(90deg); }
  .muted { opacity:var(--control-disabled-opacity); }
  .summary:hover { background:transparent;color:var(--menu-row-ink); }
  @media(prefers-reduced-motion:reduce){.chevron{transition:none;}}
</style>
