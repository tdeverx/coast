import {getSql} from './db';
import {platformStopping} from './startup';

type Probe = PromiseLike<unknown> & {cancel(): unknown};
/** One cancellable query per process, even when an unavailable pool is polled. */
export function createReadinessCheck(probe: () => Probe, stopping: () => boolean, deadlineMs = 1000) {
  let pending: Promise<boolean> | undefined;
  return (): Promise<boolean> => {
    if (stopping()) return Promise.resolve(false);
    if (pending) return pending;
    let query: Probe;
    try { query = probe(); } catch { return Promise.resolve(false); }
    const settled = Promise.resolve(query).then(() => !stopping(), () => false);
    let timer: ReturnType<typeof setTimeout>;
    const response = Promise.race([settled, new Promise<boolean>(resolve => {
      timer = setTimeout(() => { try { query.cancel(); } catch {} resolve(false); }, deadlineMs);
    })]);
    pending = response;
    // Cancellation can itself await the server. Keep returning unavailable,
    // without launching more queries, until the underlying query settles.
    void settled.then(() => { clearTimeout(timer); if (pending === response) pending = undefined; });
    return pending;
  };
}
export const databaseReady = createReadinessCheck(() => getSql()`select 1`, platformStopping);
