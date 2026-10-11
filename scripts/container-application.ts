import { chmodSync, closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import {drainStderr} from './container-stderr';

// Keep stderr independently of replaceable container stdout. Two private 256 KiB
// segments bound disk use; writes are best effort and never change child status.
const [directory, ...command] = process.argv.slice(2);
const migration = command[0] === '--migration';
if (migration) command.shift();
if (!directory || !command.length) throw new Error('Pass the data directory and application command.');
const path = `${directory}/runtime/${migration ? 'migration' : 'application'}-stderr.log`;
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
let stopping = false;
const forward = (signal: 'SIGTERM' | 'SIGINT') => { if (!stopping) { stopping = true; child.kill(signal); } };
const terminate = () => forward('SIGTERM');
const interrupt = () => forward('SIGINT');
process.on('SIGTERM', terminate);
process.on('SIGINT', interrupt);
persist(new TextEncoder().encode(`\nApplication started ${new Date().toISOString()}\n`));
try {
  process.exitCode = await drainStderr(child.stderr, child.exited, bytes => {
    persist(bytes);
    try { writeSync(2, bytes); } catch { /* A disconnected console must not stop the application. */ }
  });
} finally {
  process.off('SIGTERM', terminate);
  process.off('SIGINT', interrupt);
  if (fd !== undefined) { try { closeSync(fd); } catch {} }
}
