<script lang="ts">
  import {setContext} from 'svelte';
  import { page } from '$app/state';
  import PresentationActions from '$lib/ui/components/PresentationActions.svelte';
  import { musicCard } from '$lib/music/presentation';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';

  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const view = createMusicPage(() => data, () => page.url,()=>!!page.data.user);
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaPage {...view.page}>
 {#snippet heroActions()}{#if page.data.user&&data.item.workId}<PresentationActions item={musicCard(data.item,data.connectionId)} showTrigger />{/if}{/snippet}
</MediaPage>
