import { message } from './client';
/** One guarded operation; callers own completion, refresh and notification policy. */
export function createOperation() {
  let busy = $state(false), error = $state('');
  async function run(task: () => Promise<unknown>) {
    if (busy) return false;
    busy = true; error = '';
    try { return (await task()) !== false; }
    catch (cause) { error = message(cause); return false; }
    finally { busy = false; }
  }
  return { get busy() { return busy; }, get error() { return error; }, set error(value: string) { error = value; }, run };
}
