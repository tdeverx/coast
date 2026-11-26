<script lang="ts">
  import { page } from '$app/state';
  import PreviewExample from '../PreviewExample.svelte';
  import { goto } from '$app/navigation';
  import { resolveReference } from '../catalog';
  import { approvalStatus } from '../reference';
  import RowFilter from '#lib/ui/components/RowFilter.svelte';
  const selected = $derived(resolveReference(page.url.searchParams.get('component') ?? 'Button', page.url.searchParams.get('scenario')));
  function changeScenario(value: string) {
    if (!selected) return;
    const url = new URL(page.url.href);
    url.searchParams.set('component', selected.entry.id);
    url.searchParams.set('scenario', value);
    void goto(url, {reset: false,replace: true});
  }
</script>
<svelte:head><title>{selected?.entry.title ?? 'Unknown example'} · UI preview</title></svelte:head>
{#if selected}
  <p class="small quiet">{selected.entry.title} · {approvalStatus(selected.state.reference)}</p>
  {#if selected.entry.states.length > 1}
    <RowFilter selection groups={[{label:'Example state', value:selected.state.id, options:selected.entry.states.map(state => ({value:state.id, label:state.label})), change:changeScenario}]} />
  {/if}
  {#key selected.state.id + selected.entry.id}<PreviewExample name={selected.state.reference} initialOpen scenario={selected.state.scenario} />{/key}
{:else}<p role="alert">This example is not registered.</p>{/if}
<style>
  :global([data-coast-glass] > header), :global([data-coast-glass] > .toasts) { display:none; }
  :global(.page-shell) { padding:0 !important; min-height:0; }
</style>
