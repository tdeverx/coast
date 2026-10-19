type Download = {
  promise: Promise<Uint8Array | null>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};

/** Only active artwork reads are shared; each authorized caller owns its wait. */
export function createArtworkFlights() {
  const pending = new Map<string, Download>();
  let active = 0;
  return {
    get active() { return active; },
    has(key: string) { return pending.has(key); },
    async run(key: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<Uint8Array | null>) {
      signal.throwIfAborted();
      let download = pending.get(key);
      if (!download) {
        const entry: Download = {promise: Promise.resolve(null), controller: new AbortController(), waiters: 0, settled: false};
        active++;
        entry.promise = Promise.resolve().then(() => {
          entry.controller.signal.throwIfAborted();
          return work(entry.controller.signal);
        }).finally(() => {
          entry.settled = true;
          active--;
          if (pending.get(key) === entry) pending.delete(key);
        });
        download = entry;
        pending.set(key, entry);
      }
      download.waiters++;
      let aborted!: () => void;
      try {
        const bytes = await Promise.race([download.promise, new Promise<never>((_resolve, reject) => {
          aborted = () => reject(signal.reason ?? new DOMException('Artwork request cancelled.', 'AbortError'));
          signal.addEventListener('abort', aborted, {once: true});
          if (signal.aborted) aborted();
        })]);
        signal.throwIfAborted();
        return bytes;
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
