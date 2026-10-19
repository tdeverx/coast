export type ReaderProgress = {
  phase: 'download' | 'prepare' | 'inspect' | 'render';
  loaded?: number;
  total?: number;
};
/** Stop awaiting uncancellable decoder work as soon as this reader is closed. */
export async function readerLoad<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([cancelled, pending]);
  } finally {
    signal.removeEventListener('abort', abort!);
  }
}
