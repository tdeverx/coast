<script lang="ts">
  import { page } from '$app/state';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  let { data } = $props();
  const view = createMusicPage(() => data, () => page.url);
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaPage {...view.page} />
