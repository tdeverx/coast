<script lang="ts">
  import type { MediaView } from '$lib/ui/types';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { untrack, setContext } from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { progressTitles } from '$lib/progress';
  import { profilePath } from '$lib/profile/url';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  let { data } = $props();
  setContext('profile-read-only', () => !data.isOwner);
  let items = $state(untrack(() => data.progress.items));
  let selection = $state('');
</script>

<svelte:head><title>{progressTitles[data.surface]} · Coast</title></svelte:head>
<MediaPage collection={{items:items.filter((item): item is MediaView => !('href' in item)),selection}} context="home">
  {#if !data.isOwner}<Button href={profilePath(data.username)} emphasis="subtle" icon="left"
      >{data.username}’s profile</Button
    >{/if}
  <Shelf source={{ type: 'progress', surface: data.surface, mediums: !data.profileContext && data.surface !== 'profile', username: data.profileContext || data.surface === 'profile' || !data.isOwner
      ? data.username
      : undefined, initial: data.progress, layout: "grid", onitems: (next, key) => {
      items = next;
      selection = key;
    } }} />
</MediaPage>
