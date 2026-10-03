<script lang="ts">
  import Button from '$lib/ui/components/Button.svelte';
  import {setContext} from 'svelte';
  import { page } from '$app/state';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';

  import RecommendAction from '$lib/ui/components/RecommendAction.svelte';
  import ReactionActions from '$lib/ui/components/ReactionActions.svelte';
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  const view = createMusicPage(() => data, () => page.url,()=>!!page.data.user);
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaPage {...view.page}>
 {#snippet heroActions()}{#if page.data.user&&data.item.workId}<Button menu label="Music actions"><RecommendAction workId={data.item.workId} /><ReactionActions targetId={data.item.workId} /></Button>{/if}{/snippet}
</MediaPage>
