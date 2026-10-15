<script lang="ts">
  import { page } from '$app/state';
  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import { musicCard } from '$lib/music/presentation';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  let { data } = $props();
  const view = createMusicPage(() => data, () => page.url);
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaPage {...view.page}>
 {#snippet heroActions()}{#if page.data.user}<WorkMenu item={musicCard(data.item,data.connectionId)} showTrigger hero menuOnly />{/if}{/snippet}
</MediaPage>
