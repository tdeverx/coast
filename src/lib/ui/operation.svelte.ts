import { message } from './client';
import type { Retain } from './retention';
/** One guarded operation; callers own completion, refresh and notification policy. */
export function createOperation(retain:Retain=()=>()=>{}) {
  let busy = $state(false), error = $state('');
  async function run(task: () => Promise<unknown>) {
    if (busy) return false;
    const release=retain();
    busy = true; error = '';
    try { return (await task()) !== false; }
    catch (cause) { error = message(cause); return false; }
    finally { busy = false; release(); }
  }
  return { get busy() { return busy; }, get error() { return error; }, set error(value: string) { error = value; }, run };
}
