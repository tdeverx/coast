<script lang="ts">
  import {setContext} from 'svelte';
  import { page } from '$app/state';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import ContextMenu from '$lib/ui/components/ContextMenu.svelte';
  import RecommendAction from '$lib/ui/components/RecommendAction.svelte';
  import ReactionActions from '$lib/ui/components/ReactionActions.svelte';
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const view = createMusicPage(() => data, () => page.url,()=>!!page.data.user);
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaPage {...view.page}>
 {#snippet heroActions()}{#if page.data.user&&data.item.workId}<ContextMenu label="Music actions"><RecommendAction workId={data.item.workId} /><ReactionActions targetId={data.item.workId} /></ContextMenu>{/if}{/snippet}
</MediaPage>
