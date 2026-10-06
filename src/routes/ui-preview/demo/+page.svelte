<script lang="ts">
    import { page } from '$app/state';
  import Demo from '../Demo.svelte';
  import { providePreviewClient } from '$lib/ui/client-context';
  import { fixtureFetch } from './fixtures';
  const ready = true;
  providePreviewClient(fixtureFetch);
  const name = $derived(page.url.searchParams.get('component') ?? 'Button');
</script>
<svelte:head><title>{name}{name==='StreamsPanel'?' · Non-approved':''} · UI preview</title></svelte:head>
{#if ready}{#key name}<Demo {name} initialOpen />{/key}{/if}
<style>
  :global([data-coast-glass] > header), :global([data-coast-glass] > .hero-player), :global([data-coast-glass] > .toasts) { display:none; }
  :global(.page-shell) { padding:0 !important; min-height:0; }
</style>
