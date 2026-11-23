/** A pipe may accept only part of one diagnostic chunk. */
export function writeConsoleChunk(bytes: Uint8Array, write: (part: Uint8Array) => number) {
  let offset = 0;
  while (offset < bytes.length) {
    try {
      const written = write(bytes.subarray(offset));
      if (written <= 0) return;
      offset += written;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EINTR') throw cause;
    }
  }
}

/** A descendant retaining stderr must not hide the direct child's exit. */
export async function drainStderr(stream: ReadableStream<Uint8Array>, exited: Promise<number>, consume: (bytes: Uint8Array) => void) {
  const reader = stream.getReader();
  const drained = (async () => {
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        try { consume(value); } catch { /* Keep draining if diagnostics fail. */ }
      }
    } catch { /* The original child status wins over pipe/console failures. */ }
  })();
  const status = await exited;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([drained, new Promise<void>(resolve => { timer = setTimeout(resolve, 250); })]);
    void reader.cancel().catch(() => {});
  } finally { if (timer) clearTimeout(timer); }
  return status;
}
