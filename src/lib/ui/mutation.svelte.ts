import { invalidateAll } from '$app/navigation';
import { notifyAction } from './action-feedback.svelte';
import { message } from './client';

/** Serialize a menu's writes, then refresh its data and report successful delivery. */
export function createMutation(refresh: () => Promise<unknown>) {
  let busy = $state(false);
  let error = $state('');
  async function run(task: () => Promise<unknown>, success = 'Saved.', undo?: () => Promise<void>) {
    if (busy) return false;
    busy = true;
    error = '';
    try {
      if ((await task()) === false) return false;
      await invalidateAll();
      await refresh();
      notifyAction(success, undo);
      return true;
    } catch (cause) {
      error = message(cause);
      return false;
    } finally {
      busy = false;
    }
  }
  return {
    get busy() { return busy; },
    get error() { return error; },
    set error(value: string) { error = value; },
    run,
  };
}
