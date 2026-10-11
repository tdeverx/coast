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
