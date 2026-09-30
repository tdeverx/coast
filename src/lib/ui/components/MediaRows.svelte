<script lang="ts">
  import type { mediaRows } from '$lib/server/queries/media-rows';
  import PresentationShelf from './PresentationShelf.svelte';
  let {
    rows,
    personal = false,
  }: { rows: Awaited<ReturnType<typeof mediaRows>>; personal?: boolean } = $props();
  const ownGames = $derived(personal || rows.personal);
</script>

{#if rows.enabled}
  <PresentationShelf
    refreshKey={rows}
    title="Music"
    music
    empty="Music from your connected libraries will appear here."
  />
  <PresentationShelf
    refreshKey={rows}
    title={ownGames ? 'Your games' : 'Games'}
    personal={ownGames}
    empty={ownGames
      ? 'Start a playthrough to keep your games here.'
      : 'Add games to your library to find them here.'}
  />
{/if}
