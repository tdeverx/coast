export class PlaybackSavePending extends Error {
  constructor() { super('Save the previous playback progress with Retry before starting another item.'); }
}
export type PlaybackSave = { saved: boolean; disabled?: boolean };
export type StopSaveState = 'idle' | 'saving' | 'failed';

/** Visible playback may close; successor preparation still owns this acknowledgement barrier. */
export function createPlaybackStop(changed: (state: StopSaveState) => void) {
  type Save = { send: () => Promise<PlaybackSave>; attempt?: Promise<boolean> };
  let pending: Save | undefined;
  let state: StopSaveState = 'idle';
  function publish(next: StopSaveState) {
    state = next;
    changed(next);
  }
  function attempt(save: Save): Promise<boolean> {
    if (save.attempt) return save.attempt;
    publish('saving');
    save.attempt = Promise.resolve().then(save.send).catch((): PlaybackSave => ({ saved: false })).then(result => {
      if (pending !== save) return false;
      if (result.saved || result.disabled) {
        pending = undefined;
        publish('idle');
      }
      else publish('failed');
      return result.saved || !!result.disabled;
    }).finally(() => { save.attempt = undefined; });
    return save.attempt;
  }
  return {
    start(send: Save['send']) {
      if (pending) throw new Error('The previous playback save is still pending.');
      pending = { send };
      void attempt(pending);
    },
    retry() { return pending ? attempt(pending) : Promise.resolve(true); },
    async wait() {
      const save = pending;
      if (!save) return;
      if (state === 'failed' || !await attempt(save))
        throw new PlaybackSavePending();
    },
    clear() {
      pending = undefined;
      publish('idle');
    },
  };
}
