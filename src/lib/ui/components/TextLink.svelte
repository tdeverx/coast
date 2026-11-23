<script lang="ts">
  import Icon from './Icon.svelte';
  let {href,text,label,dialog=false,onclick}: {
    href?:string;text:string;label?:string;dialog?:boolean;onclick?:(event:MouseEvent)=>void
  }=$props();
</script>

{#snippet content()}<span>{text}</span><Icon name="right" size={12}/>{/snippet}
{#if href !== undefined}
  <a {href} {onclick} aria-label={label}>{@render content()}</a>
{:else}
  <button type="button" {onclick} aria-label={label} aria-haspopup={dialog ? 'dialog' : undefined}>{@render content()}</button>
{/if}

<style>
  a, button { display:inline-flex; align-items:center; gap:var(--text-link-gap,4px); max-width:100%; min-width:0; vertical-align:bottom; color:inherit; font-weight:var(--weight-semibold); }
  button { padding:0; border:0; background:transparent; }
  span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
  :is(a,button) :global(svg) { flex-shrink:0; opacity:0.6; }
  :is(a,button):is(:hover,:focus-visible) :global(svg) { opacity:1; }
</style>
