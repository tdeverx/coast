import { chmodSync, closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';

// Keep stderr independently of replaceable container stdout. Two private 256 KiB
// segments bound disk use; writes are best effort and never change child status.
const [directory, ...command] = process.argv.slice(2);
if (!directory || !command.length) throw new Error('Pass the data directory and application command.');
const path = `${directory}/runtime/application-stderr.log`;
const limit = 256 * 1024;
let fd: number | undefined;
let size = 0;
function persist(bytes: Uint8Array) {
  try {
    if (fd === undefined) {
      mkdirSync(`${directory}/runtime`, { recursive: true, mode: 0o700 });
      fd = openSync(path, 'a', 0o600);
      chmodSync(path, 0o600);
      size = statSync(path).size;
    }
    for (let offset = 0; offset < bytes.length;) {
      if (size >= limit) {
        closeSync(fd); fd = undefined;
        renameSync(path, `${path}.1`);
        fd = openSync(path, 'a', 0o600); size = 0;
      }
      const part = bytes.subarray(offset, offset + Math.min(limit - size, bytes.length - offset));
      const written = writeSync(fd, part);
      size += written; offset += written;
    }
  } catch {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    fd = undefined;
  }
}
const child = Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'pipe' });
const terminate = () => child.kill('SIGTERM');
const interrupt = () => child.kill('SIGINT');
process.on('SIGTERM', terminate);
process.on('SIGINT', interrupt);
persist(new TextEncoder().encode(`\nApplication started ${new Date().toISOString()}\n`));
try {
  for await (const bytes of child.stderr) {
    persist(bytes);
    try { writeSync(2, bytes); } catch { /* A disconnected console must not stop the application. */ }
  }
  process.exitCode = await child.exited;
} finally {
  process.off('SIGTERM', terminate);
  process.off('SIGINT', interrupt);
  if (fd !== undefined) { try { closeSync(fd); } catch {} }
}
