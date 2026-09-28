<script lang="ts">
  import type { MediaView } from '$lib/ui/types';
  import { change, message, ApiError } from '$lib/ui/client';
  import Shelf from './Shelf.svelte';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Rating from './Rating.svelte';
  let {
    episodes,
    href,
    layout = 'row',
  }: { episodes: MediaView[]; href?: string; layout?: 'row' | 'grid' } = $props();
  let error = $state(''),
    busy = $state(false),
    confirm = $state(false),
    warning = $state(''),
    pending = $state<{ id: string; watched: boolean; bulk: boolean } | null>(null);
  async function watched(id: string, value: boolean, bulk = false, acknowledged = false) {
    busy = true;
    error = '';
    try {
      await change(bulk ? 'tracking/bulk' : 'tracking', {
        mediaId: id,
        action: value ? 'unwatch' : 'watch',
        acknowledged,
      });
      confirm = false;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        pending = { id, watched: value, bulk };
        warning = e.message;
        confirm = true;
      } else error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<Shelf
  {href}
  {layout}
  filterBy="watched"
  title="Episodes"
  items={episodes}
  shape="fanart"
  artworkStyle="thumb"
>
  {#snippet details(episode)}
    <div class="episode-details">
      {#if episode.overview}<details>
          <summary>Episode overview</summary>
          <p>{episode.overview}</p>
        </details>{/if}
      <div class="episode-meta">
        {#if episode.runtimeMinutes}<small>{episode.runtimeMinutes} min</small>{/if}
        <Rating mediaId={episode.id} value={episode.rating} />
        <button
          class="icon-button"
          class:selected={episode.watched}
          aria-pressed={episode.watched}
          disabled={busy}
          aria-label={`${episode.watched ? 'Mark unwatched' : 'Mark watched'}: ${episode.title}`}
          onclick={() => watched(episode.id, episode.watched)}><Icon name="check" /></button
        >
      </div>
    </div>
  {/snippet}
  {#snippet empty()}<p class="muted">No episodes in this season yet.</p>{/snippet}
</Shelf>
{#if error}<div class="notice error" role="alert">{error}</div>{/if}
<Dialog bind:open={confirm} title="Review episode change"
  ><div class="stack">
    <p>{warning}</p>
    <Button
      variant="danger"
      disabled={busy}
      onclick={() => pending && watched(pending.id, pending.watched, pending.bulk, true)}
      >Confirm change</Button
    >
  </div></Dialog
>

<style>
  .episode-details {
    display: grid;
    gap: 12px;
    margin-top: 8px;
  }
  .episode-details p {
    font-size: 11px;
    line-height: 1.6;
  }
  .episode-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .episode-meta small {
    color: var(--muted);
  }
  .episode-meta .icon-button {
    margin-left: auto;
  }
</style>
