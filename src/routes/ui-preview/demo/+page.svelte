<script lang="ts">
    import { page } from '$app/state';
  import PreviewExample from '../PreviewExample.svelte';
  import { goto } from '$app/navigation';
  import { referenceEntries } from '../catalog';
  import { approvalStatus } from '../reference';
  const name = $derived(page.url.searchParams.get('component') ?? 'Button');
  const entry = $derived(referenceEntries.find(entry => entry.id === name));
  function changeScenario(value: string) {
    const url = new URL(page.url.href);
    url.searchParams.set('scenario', value);
    void goto(url, {reset: false,replace: true});
  }
</script>
<svelte:head><title>{entry?.title ?? 'Unknown example'} · UI preview</title></svelte:head>
{#if entry}
  <p class="small quiet">{entry.title} · {approvalStatus(name)}</p>
  {#key name}<PreviewExample {name} initialOpen initialScenario={page.url.searchParams.get('scenario')} onchange={changeScenario} />{/key}
{:else}<p role="alert">This example is not registered.</p>{/if}
<style>
  :global([data-coast-glass] > header), :global([data-coast-glass] > .toasts) { display:none; }
  :global(.page-shell) { padding:0 !important; min-height:0; }
</style>
