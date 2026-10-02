import { mkdir, readdir, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One app process owns the cache. Admission includes temporary-file allocation. */
export function createImageCache(directory: string, limits = { bytes: 1024 ** 3, files: 10_000, freeBytes: 128 * 1024 ** 2 }) {
  const entries = new Map<string, { bytes: number; used: number }>();
  let initialized = false;
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
  async function initialize() {
    if (initialized) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(directory)) {
      if (/^[a-f0-9]{64}\.image\.[a-f0-9-]+$/.test(file)) {
        await unlink(join(directory, file));
      } else if (/^[a-f0-9]{64}\.image$/.test(file)) {
        const info = await stat(join(directory, file));
        entries.set(file, { bytes: info.size, used: info.mtimeMs });
      }
    }
    initialized = true;
    await trim(0, 0);
  }
  async function trim(bytes: number, files: number) {
    let total = [...entries.values()].reduce((sum, item) => sum + item.bytes, 0);
    for (const [key, item] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
      if (total + bytes <= limits.bytes && entries.size + files <= limits.files) break;
      await unlink(join(directory, key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      entries.delete(key);
      total -= item.bytes;
    }
  }
  return {
    get(key: string) {
      return serial(async () => {
        await initialize();
        try {
          const bytes = await readFile(join(directory, key));
          entries.set(key, { bytes: bytes.byteLength, used: Date.now() });
          return bytes;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          entries.delete(key);
          return null;
        }
      });
    },
    put(key: string, bytes: Uint8Array) {
      return serial(async () => {
        await initialize();
        if (entries.has(key)) return true;
        if (bytes.byteLength > limits.bytes || limits.files < 1) return false;
        await trim(bytes.byteLength, 1);
        const space = await statfs(directory);
        if (space.bavail * space.bsize - bytes.byteLength < limits.freeBytes) return false;
        const temporary = join(directory, `${key}.${crypto.randomUUID()}`);
        try {
          await writeFile(temporary, bytes, { mode: 0o600 });
          await rename(temporary, join(directory, key));
          entries.set(key, { bytes: bytes.byteLength, used: Date.now() });
          return true;
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      });
    },
  };
}
