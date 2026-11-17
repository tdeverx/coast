import { ApiError } from '../client';

const retryDelay = 250;
const transientStatuses = new Set([408, 500, 502, 503, 504]);

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>(resolve => {
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    const timer = setTimeout(finish, retryDelay);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** One retry for a transient read, owned by the menu's existing cancellation scope. */
export async function retryMenuRead<T>(read: () => Promise<T>, signal: AbortSignal, current: () => boolean) {
  signal.throwIfAborted();
  try {
    return await read();
  } catch (cause) {
    signal.throwIfAborted();
    const transient = cause instanceof TypeError ||
      (cause instanceof ApiError && transientStatuses.has(cause.status));
    if (!transient || !current()) throw cause;
    await waitForRetry(signal);
    signal.throwIfAborted();
    if (!current()) throw cause;
    return read();
  }
}
