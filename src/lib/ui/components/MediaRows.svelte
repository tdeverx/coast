<script lang="ts">
  import type { mediaRows } from '$lib/server/queries/media-rows';
  import PresentationShelf from './PresentationShelf.svelte';
  let {
    rows,
    personal = false,
  }: { rows: Awaited<ReturnType<typeof mediaRows>>; personal?: boolean } = $props();
</script>

{#if rows.enabled}
  {#await rows.music}<PresentationShelf title="Music" href="/music" music busy />
  {:then result}<PresentationShelf
      title="Music"
      href="/music"
      music
      {...result}
      empty="Music from your connected libraries will appear here."
    />{/await}
  {#await rows.games}<PresentationShelf
      title={personal ? 'Your games' : 'Games'}
      href="/games"
      busy
    />
  {:then result}<PresentationShelf
      title={personal ? 'Your games' : 'Games'}
      href="/games"
      {...result}
      empty={personal
        ? 'Start a playthrough to keep your games here.'
        : 'Add games to your library to find them here.'}
    />{/await}
{/if}
