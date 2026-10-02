<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Demo from '../Demo.svelte';
  import { installFixtures } from './fixtures';
  let ready = $state(false);
  const name = $derived(page.url.searchParams.get('component') ?? 'Button');
  onMount(() => { const restore = installFixtures(); ready = true; return restore; });
</script>
<svelte:head><title>{name} · UI preview</title></svelte:head>
{#if ready}{#key name}<Demo {name} initialOpen />{/key}{/if}
<style>
  :global([data-coast-glass] > header), :global([data-coast-glass] > .hero-player), :global([data-coast-glass] > .toasts) { display:none; }
  :global(.page-shell) { padding:0 !important; min-height:0; }
</style>
