<script lang="ts">
  import LibraryShelf from '$lib/ui/components/LibraryShelf.svelte';
  import RowHeader from '$lib/ui/components/RowHeader.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Library · Coast</title></svelte:head>
<div class="content page route-content">
  {#if data.view === 'watch'}<Button href="/library" variant="ghost" icon="left">Library</Button>
  {:else}<RowHeader title="Library">{#snippet heading()}<h1>Library</h1>{/snippet}</RowHeader>{/if}
  {#if data.filters.genre}<div class="row section">
      <p class="small">Genre: {data.filters.genre}</p>
      <Button href="/library?view=watch&scope=all" variant="ghost" icon="close">Clear genre</Button>
    </div>{/if}
  {#key `${data.view}:${data.filters.genre}:${data.filters.kind}:${data.filters.scope}:${data.filters.tracking}`}
    <LibraryShelf
      surface="watch"
      layout={data.view === 'watch' ? 'grid' : 'row'}
      initial={data.content ?? undefined}
      genre={data.filters.genre}
      initialSelection={data.filters.tracking}
      initialKind={data.filters.kind}
      initialScope={data.filters.scope}
    />
  {/key}
  {#if data.view === 'overview' && data.experimentalFeatures}<LibraryShelf
      surface="listen"
    /><LibraryShelf surface="play" />{/if}
</div>

<style>
  h1 {
    font-size: var(--row-title-size);
    font-weight: var(--row-title-weight);
    margin: 0;
  }
</style>
