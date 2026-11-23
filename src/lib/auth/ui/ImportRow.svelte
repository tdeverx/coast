<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  let { label, provider, state, processed = 0, total = null, stage, recovery }: {
    label:string; provider:'jellyfin'|'trakt'; state:string; processed?:number; total?:number|null; stage?:string; recovery?:Snippet;
  } = $props();
  const percent = $derived(total !== null && total > 0 ? Math.min(100,Math.floor(processed / total * 100)) : null);
</script>
<div class="menu-row status-row" title={stage}>
  <Icon name={provider} size={16} /><span class="row-label">{label}</span>
  {#if state === 'succeeded'}
    <span class="complete"><Icon name="checkCircle" size={16}/><span class="sr-only">Complete</span></span>
  {:else if recovery && ['failed','cancelled','reconnect'].includes(state)}
    {@render recovery()}
  {:else if state === 'running' && percent !== null}
    <span class="menu-row-note" role="progressbar" aria-label={label} aria-valuenow={percent}>{percent}%</span>
  {:else}
    <span class="menu-row-note">{state === 'running' ? 'Importing…' : state === 'pending' ? 'Queued' : 'Needs attention'}</span>
  {/if}
</div>
<style>
  .row-label { flex:1; min-width:0; }
  .status-row:hover { color:var(--menu-row-ink); background:transparent; }
  .status-row :global(.button) { width:auto; }
  .complete { display:inline-flex; color:var(--field-success, var(--success)); }
</style>
