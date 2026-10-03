import { refreshAfterChange, message, type api, type change } from '$lib/ui/client';
import { sequencePath, type SequenceSource } from '$lib/media/sequence';
import type { MediaView } from '$lib/ui/types';
import { playMedia, playMusicQueue } from '$lib/playback/client.svelte';

/** Playback state supplies ordinary buttons and a Dialog, never a second control renderer. */
export function createSequencePlayback(options: {
  source: () => SequenceSource | undefined; from?: () => string | undefined;
  experimentalMusic: () => boolean; preview: boolean; api: typeof api; change: typeof change;
}) {
  let open = $state(false), busy = $state(false), error = $state(''), next = $state<MediaView | null>(null);
  async function start(restart = false, after?: string) {
    const source = options.source();
    if (options.preview || !source || busy) return;
    busy = true; error = '';
    try {
      if (source.kind === 'playlist' && !after) {
        if (options.experimentalMusic()) {
          const music = await options.api<Parameters<typeof playMusicQueue>[0] | null>(`music/queue?listId=${source.id}`, undefined, 'GET');
          if (music) { await playMusicQueue(music); open = false; return; }
        }
        await options.change(`lists/${source.id}/playback`, { restart });
        void refreshAfterChange('tracking');
      }
      if (source.kind === 'collection' && restart)
        await options.change('rewatch', { mediaId: source.id, startedAt: new Date().toISOString() });
      const result = await options.api<{next: MediaView | null}>(sequencePath(source, {after, from: options.from?.()}), undefined, 'GET');
      next = result.next;
      if (next?.available) {
        await playMedia(next.id, {sequence: next.sequence, continuationId: source.kind === 'collection' ? source.id : undefined});
        open = false;
      } else open = true;
    } catch (cause) {error = message(cause); open = true;}
    finally {busy = false;}
  }
  return {
    start, get error() {return error;}, get busy() {return busy;}, get open() {return open;}, set open(value: boolean) {open = value;},
    get title() {return error ? 'Playback unavailable' : next ? 'Next item unavailable' : 'Sequence complete';},
    get message() {return error || (next ? `${next.title} is next in this sequence, but is not available to play.` : 'Every item has been watched. Start again without changing your history.');},
    get actions() {
      return [
        ...error ? [] : next ? [
          {text: 'Skip this item', disabled: busy, onclick: () => start(false, next!.sequence!.entryId)},
          {text: 'View details', href: `/media/${next.id}`},
        ] : [{text: 'Start again', disabled: busy, onclick: () => start(true)}],
        {text: 'Close', emphasis: 'subtle' as const, onclick: () => {open = false;}},
      ];
    },
  };
}
