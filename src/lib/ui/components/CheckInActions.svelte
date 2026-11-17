<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { checkinEpisodeLabel, episodeCheckinScope, type ActiveCheckin, type CheckinEpisodePage, type CheckinTrackPage } from '#lib/social/checkins.js';
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import { createMenuResource } from '#lib/ui/controls/menu-resource.svelte.js';
  import { retryMenuRead } from '#lib/ui/controls/menu-read-retry.js';
  import { workMenuScope } from '#lib/ui/controls/work.svelte.js';
  import { createOperation } from '#lib/ui/operation.svelte.js';
  import { useRetention } from '#lib/ui/retention.js';
  import Button from './Button.svelte';

  let { workId, kind, active = null, disabled = false, preferredWorkId, preferredLabel, onchange }: {
    workId: string; kind: string; active?: ActiveCheckin | null; disabled?: boolean;
    preferredWorkId?: string; preferredLabel?: string;
    onchange?: (value: ActiveCheckin | null) => void;
  } = $props();
  const { api, change, feedback } = useClient();
  const operation = createOperation(useRetention());
  let number = $state(1);
  let chooserWork: string | undefined;
  let acknowledged = $state<{ workId: string; source: ActiveCheckin | null; value: ActiveCheckin | null }>();
  const artist = $derived(kind === 'artist');
  const group = $derived(episodeCheckinScope(kind) || artist);
  const key = () => workMenuScope([kind, workId, number]);
  const episodes = createMenuResource<CheckinEpisodePage | CheckinTrackPage>(
    () => ({ items: [], hasMore: false }), key,
    signal => api(artist ? `social/checkins/tracks?workId=${workId}&page=${number}` : `social/checkins/episodes?workId=${workId}&page=${number}`, undefined, 'GET', { signal }),
    retryMenuRead
  );
  const observed = $derived(artist && 'activeCheckin' in episodes.data ? episodes.data.activeCheckin : active);
  const current = $derived(acknowledged?.workId === workId && acknowledged.source === observed ? acknowledged.value : observed);
  $effect(() => {
    const target = workId, scope = key();
    untrack(() => {
      if (chooserWork !== target) {
        chooserWork = target;
        number = 1;
        acknowledged = undefined;
        episodes.sync();
      } else episodes.sync(scope);
      if (episodes.active && !disabled) void episodes.load();
    });
  });
  onDestroy(episodes.dispose);
  function open() {
    if (artist) void episodes.refresh();
    return episodes.open();
  }
  function close() { episodes.close(); number = 1; }
  function publish(target: string, source: ActiveCheckin | null, value: ActiveCheckin | null) {
    if (workId !== target) return;
    acknowledged = { workId: target, source, value };
    onchange?.(value);
  }
  async function start(target: string, parentWorkId?: string) {
    const owner = workId, source = observed;
    const succeeded = await operation.run(async () => {
      const next = await change<ActiveCheckin>('social/checkins', { workId: target, ...(artist ? {artistWorkId: owner} : {parentWorkId}) });
      publish(owner, source, next);
      feedback.notify('Checked in.');
    });
    if (!succeeded && operation.error) feedback.failure(operation.error);
  }
  async function primary() {
    if(current)return end('cancel');
    if(preferredWorkId)return start(preferredWorkId,workId);
    number=1;
    const page=await episodes.open();
    if(current)return end('cancel');
    const first=page?.items[0];
    if(first)await start(first.id,workId);
    else if(!episodes.error)feedback.notify(artist?'No known tracks to check in to.':'No aired episodes to check in to.');
  }
  async function end(action: 'finish' | 'cancel') {
    const owner = workId, source = observed, checkin = current;
    if (!checkin) return;
    const succeeded = await operation.run(async () => {
      const result = await change<{ state: string }>(`social/checkins/${checkin.id}`, { action });
      publish(owner, source, null);
      feedback.notify(result.state === 'completed' ? 'Check-in finished.' : 'Check-in cancelled.');
    });
    if (!succeeded && operation.error) feedback.failure(operation.error);
  }
  reportFailure(() => episodes.error && `Could not load ${artist ? 'tracks' : 'episodes'}. ${episodes.error}`);
</script>

{#if current?.mode === 'manual'}
  <Button menu label="Cancel check-in" icon="userCheck" panel keepOpen disabled={disabled || operation.busy} primaryAction={()=>end('cancel')}>
    <Button item icon="close" keepOpen disabled={disabled || operation.busy} onclick={() => end('cancel')}>Cancel check-in</Button>
    <div class="menu-divider" role="separator"></div>
    <Button item icon="check" keepOpen disabled={disabled || operation.busy} onclick={() => end('finish')}>Finish check-in</Button>
  </Button>
{:else if current}
  <Button item icon="close" keepOpen disabled={disabled || operation.busy} onclick={() => end('cancel')}>Cancel check-in</Button>
{:else if group}
  <Button menu label="Check in" icon="userCheck" panel keepOpen disabled={disabled || operation.busy} primaryAction={primary} onopen={open} onclose={close}>
    {@const first=episodes.data.items[0]}
    <Button item icon="userCheck" keepOpen disabled={disabled || operation.busy || (!preferredWorkId&&!first)} onclick={primary}>
      Check in{preferredLabel?` to ${preferredLabel}`:first?` to ${'seasonNumber' in first?checkinEpisodeLabel(first):first.title}`:''}
    </Button>
    <div class="menu-divider" role="separator"></div>
    {#each episodes.data.items.filter(item=>item.id!==(preferredWorkId??first?.id)) as episode (episode.id)}
      <Button item keepOpen disabled={disabled || operation.busy || episodes.busy} onclick={() => start(episode.id, workId)}>{'seasonNumber' in episode && 'episodeNumber' in episode && typeof episode.seasonNumber==='number' && typeof episode.episodeNumber==='number' ? checkinEpisodeLabel({id:episode.id,title:episode.title,seasonNumber:episode.seasonNumber,episodeNumber:episode.episodeNumber}) : episode.title}</Button>
    {/each}
    {#if episodes.busy}<div class="menu-label" role="status">Loading {artist ? 'tracks' : 'episodes'}…</div>
    {:else if episodes.error}<div class="menu-label" role="status">{artist ? 'Tracks' : 'Episodes'} unavailable</div>
    {:else if !episodes.data.items.length}<div class="menu-label">{artist ? 'No known tracks' : 'No aired episodes'}</div>{/if}
    {#if number > 1 || episodes.data.hasMore}
      <div class="menu-divider" role="separator"></div>
      {#if number > 1}<Button item icon="left" keepOpen disabled={episodes.busy || operation.busy} onclick={() => { number -= 1; }}>Previous {artist ? 'tracks' : 'episodes'}</Button>{/if}
      {#if episodes.data.hasMore}<Button item icon="right" keepOpen disabled={episodes.busy || operation.busy} onclick={() => { number += 1; }}>More {artist ? 'tracks' : 'episodes'}</Button>{/if}
    {/if}
  </Button>
{:else}
  <Button item icon="userCheck" keepOpen disabled={disabled || operation.busy} onclick={() => start(workId)}>Check in</Button>
{/if}
