<script lang="ts">
  import { untrack, setContext } from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { progressTitles } from '$lib/progress';
  import { profilePath } from '$lib/profile/url';
  import ProgressShelf from '$lib/ui/components/ProgressShelf.svelte';
  import CollectionPage from '$lib/ui/components/CollectionPage.svelte';
  let { data } = $props();
  setContext('profile-read-only', () => !data.isOwner);
  let items = $state(untrack(() => data.progress.items));
  let selection = $state('');
</script>

<svelte:head><title>{progressTitles[data.surface]} · Coast</title></svelte:head>
<CollectionPage hero {items} {selection}>
  {#if !data.isOwner}<Button href={profilePath(data.username)} variant="ghost" icon="left"
      >{data.username}’s profile</Button
    >{/if}
  <ProgressShelf
    surface={data.surface}
    username={data.profileContext || data.surface === 'profile' || !data.isOwner
      ? data.username
      : undefined}
    initial={data.progress}
    layout="grid"
    onitems={(next, key) => {
      items = next;
      selection = key;
    }}
  />
</CollectionPage>
