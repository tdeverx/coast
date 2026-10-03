import { notifyAction } from './action-feedback.svelte';
import { createOperation } from './operation.svelte';
/** Serialize a menu's writes, then refresh its data and report successful delivery. */
export function createMutation(refresh: () => Promise<unknown>) {
  const operation = createOperation();
  return {
    get busy() { return operation.busy; },
    get error() { return operation.error; },
    set error(value: string) { operation.error = value; },
    run(task: () => Promise<unknown>, success = 'Saved.', undo?: () => Promise<void>) {
      return operation.run(async () => {
        if ((await task()) === false) return false;
        await refresh();
        notifyAction(success, undo);
      });
    },
  };
}
