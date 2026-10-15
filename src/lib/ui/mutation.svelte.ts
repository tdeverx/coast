import { notifyAction } from './action-feedback.svelte';
import { createOperation } from './operation.svelte';
/** Acknowledged writes succeed even when the optional local refresh fails. */
export function createMutation(refresh: () => Promise<unknown>) {
  const operation = createOperation();
  return {
    get busy() { return operation.busy; },
    get error() { return operation.error; },
    set error(value: string) { operation.error = value; },
    run(task: () => Promise<unknown>, success = 'Saved.', undo?: () => Promise<void>) {
      return operation.run(async () => {
        if ((await task()) === false) return false;
        notifyAction(success, undo);
        try { await refresh(); }
        catch { operation.error = 'Saved. Actions could not refresh; reopen or retry loading them.'; }
      });
    },
  };
}
