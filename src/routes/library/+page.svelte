<script lang="ts">
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Library · Coast</title></svelte:head>
<div class="content page route-content">
  {#if data.view === 'watch'}<Button href="/library" variant="ghost" icon="left">Library</Button>
  {:else}<Heading title="Library">{#snippet heading()}<h1>Library</h1>{/snippet}</Heading>{/if}
  {#if data.filters.genre}<div class="row section">
      <p class="small">Genre: {data.filters.genre}</p>
      <Button href="/library?view=watch&scope=all" variant="ghost" icon="close">Clear genre</Button>
    </div>{/if}
  {#key `${data.view}:${data.filters.genre}:${data.filters.kind}:${data.filters.scope}:${data.filters.tracking}`}
    <Shelf source={{ type: 'library', surface: "watch", layout: data.view === 'watch' ? 'grid' : 'row', initial: data.content ?? undefined, genre: data.filters.genre, initialSelection: data.filters.tracking, initialKind: data.filters.kind, initialScope: data.filters.scope }} />
  {/key}
  {#if data.view === 'overview' && data.experimentalFeatures}<Shelf source={{ type: 'library', surface: "listen" }} /><Shelf source={{ type: 'library', surface: "play" }} />{/if}
</div>

<style>
  h1 {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin: 0;
  }
</style>
