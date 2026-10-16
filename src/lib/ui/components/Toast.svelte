<script lang="ts">
  import Button from './Button.svelte';
  let { text, description, error, kind = 'info', busy = false, actionLabel, onaction, onopen, ondismiss, dismissLabel = 'Dismiss message' }: {
    text:string; description?:string|null; error?:string; kind?:'info'|'error'; busy?:boolean;
    actionLabel?:string; onaction?:()=>unknown; onopen?:()=>void; ondismiss?:()=>void; dismissLabel?:string;
  } = $props();
</script>
<div class="toast solid-surface" role={kind === 'error' ? 'alert' : 'status'}>
  {#if onopen}<button class="toast-open" onclick={onopen}><h3>{text}</h3>{#if description}<p>{description}</p>{/if}</button>
  {:else}<div class="action-message"><p>{text}</p>{#if description}<p>{description}</p>{/if}{#if error}<p class="text-danger">{error}</p>{/if}
    {#if onaction}<Button emphasis="subtle" disabled={busy} onclick={()=>void onaction()}>{actionLabel ?? 'Retry'}</Button>{/if}
  </div>{/if}
  {#if ondismiss}<Button size="icon" icon="close" iconSize={17} label={dismissLabel} class="toast-dismiss" disabled={busy} onclick={ondismiss} />{/if}
</div>
<style>
  .toast {border-radius:16px;padding:16px;display:flex;align-items:flex-start;gap:10px;animation:appear var(--motion);}
  .action-message,.toast-open {flex:1;min-width:0;}
  .toast-open {text-align:left;color:inherit;cursor:pointer;}
  h3,p {font-size:var(--text-sm);overflow-wrap:anywhere;}
  p+p,h3+p {margin-top:5px;}
  .toast :global(.toast-dismiss) {width:28px;height:28px;flex:none;}
</style>
