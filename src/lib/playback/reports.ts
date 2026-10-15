type Report = { sessionId: string; event: string; send: () => Promise<boolean>; promise: Promise<boolean>; resolve: (saved: boolean) => void };

/** Preserve lifecycle order; only consecutive, not-yet-sent position snapshots are replaceable. */
export function createPlaybackReports() {
  const pending: Report[] = [];
  let sending = false;
  function drain() {
    if (sending || !pending.length) return;
    sending = true;
    const report = pending.shift()!;
    void Promise.resolve().then(() => report.send()).then(report.resolve, () => report.resolve(false)).finally(() => {
      sending = false;
      drain();
    });
  }
  return (sessionId: string, event: string, send: () => Promise<boolean>) => {
    const latest = pending.at(-1);
    if (event === 'progress' && latest?.event === 'progress' && latest.sessionId === sessionId) {
      latest.send = send;
      return latest.promise;
    }
    let resolve!: Report['resolve'];
    const promise = new Promise<boolean>(done => { resolve = done; });
    pending.push({ sessionId, event, send, promise, resolve });
    drain();
    return promise;
  };
}
