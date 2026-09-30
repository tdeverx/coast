<script lang="ts">
  import { gameFacts, type GameMetadata } from '$lib/games/presentation';
  import ContentRow from './ContentRow.svelte';
  import DetailCard from './DetailCard.svelte';
  import FactList from './FactList.svelte';
  let { item }: { item: GameMetadata } = $props();
  const facts = $derived(gameFacts(item));
</script>
{#if item.overview || facts.length}<ContentRow title="Overview" size="panel" artworkOptions={false}>
  {#if item.overview}<DetailCard title="About"><p>{item.overview}</p></DetailCard>{/if}
  {#if facts.length}<DetailCard title="Details"><FactList items={facts} /></DetailCard>{/if}
</ContentRow>{/if}
