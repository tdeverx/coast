<script lang="ts">
  import CardLayoutEditor from '#lib/ui/cards/editor/CardLayoutEditor.svelte';
  import type { ApiTransport } from '#lib/ui/client.js';

  const transport: ApiTransport = async (input, init) => (await import('../demo/fixtures')).fixtureFetch(input, init);
</script>

<svelte:head><title>Media card preview · Coast</title></svelte:head>

<CardLayoutEditor backHref="/ui-preview" backLabel="Back to UI playground" {transport} />
