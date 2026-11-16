type Flight<T> = {
  promise: Promise<T>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};

/** Each caller owns its wait. The final departure cancels the underlying read. */
export function createSharedFlights<T>() {
  const pending = new Map<string, Flight<T>>();
  let active = 0;
  return {
    get active() { return active; },
    has(key: string) { return pending.has(key); },
    async run(key: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>) {
      signal.throwIfAborted();
      let download = pending.get(key);
      if (!download) {
        const controller = new AbortController();
        const promise = Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return work(controller.signal);
        }).finally(() => {
          entry.settled = true;
          active--;
          if (pending.get(key) === entry) pending.delete(key);
        });
        const entry: Flight<T> = {promise, controller, waiters: 0, settled: false};
        active++;
        download = entry;
        pending.set(key, entry);
      }
      download.waiters++;
      let aborted!: () => void;
      try {
        const value = await Promise.race([download.promise, new Promise<never>((_resolve, reject) => {
          aborted = () => reject(signal.reason ?? new DOMException('Provider read cancelled.', 'AbortError'));
          signal.addEventListener('abort', aborted, {once: true});
          if (signal.aborted) aborted();
        })]);
        signal.throwIfAborted();
        return value;
      } finally {
        signal.removeEventListener('abort', aborted);
        download.waiters--;
        if (!download.waiters && !download.settled) {
          download.controller.abort();
          if (pending.get(key) === download) pending.delete(key);
        }
      }
    },
  };
}
