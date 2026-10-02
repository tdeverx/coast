<script lang="ts">
  import { refreshAfterChange } from '$lib/ui/client';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import { sequencePath, type SequenceSource } from '$lib/media/sequence';
  import type { MediaView } from '$lib/ui/types';
  import { playMedia,playMusicQueue } from '$lib/playback/client.svelte';
  import {page} from '$app/state';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';

  const { api, change, preview } = useClient();

  let {
    source,
    from,
    hidden = false,
  }: { source: SequenceSource; from?: string; hidden?: boolean } = $props();
  let open = $state(false),
    busy = $state(false),
    error = $state(''),
    next = $state<MediaView | null>(null);
  export async function start(restart = false, after?: string) {
    if (preview) return;
    busy = true;
    error = '';
    try {
      if (source.kind === 'playlist' && !after) {
        if(page.data.experimentalFeatures){
          const music=await api<Parameters<typeof playMusicQueue>[0]|null>(`music/queue?listId=${source.id}`,undefined,'GET');
          if(music){await playMusicQueue(music);open=false;return;}
        }
        await change(`lists/${source.id}/playback`, { restart });
        void refreshAfterChange('tracking');
      }
      if (source.kind === 'collection' && restart)
        await change('rewatch', { mediaId: source.id, startedAt: new Date().toISOString() });
      const result = await api<{ next: MediaView | null }>(
        sequencePath(source, { after, from }),
        undefined,
        'GET'
      );
      next = result.next;
      if (next?.available) {
        await playMedia(next.id, {
          sequence: next.sequence,
          continuationId: source.kind === 'collection' ? source.id : undefined,
        });
        open = false;
      } else open = true;
    } catch (cause) {
      error = message(cause);
      open = true;
    } finally {
      busy = false;
    }
  }
</script>

{#if !hidden}<Button variant="ghost" icon="play" disabled={busy} onclick={() => start()}
    >Play playlist</Button
  >{/if}
<Dialog
  bind:open
  title={error ? 'Playback unavailable' : next ? 'Next item unavailable' : 'Sequence complete'}
>
  <div class="stack">
    {#if error}<p role="alert">{error}</p>
    {:else if next}<p>{next.title} is next in this sequence, but is not available to play.</p>
      <div class="row">
        <Button disabled={busy} onclick={() => start(false, next!.sequence!.entryId)}
          >Skip this item</Button
        ><Button href={`/media/${next.id}`} variant="secondary">View details</Button>
      </div>
    {:else}<p>Every item has been watched. Start again without changing your history.</p>
      <Button disabled={busy} onclick={() => start(true)}>Start again</Button>
    {/if}
    <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
  </div>
</Dialog>
