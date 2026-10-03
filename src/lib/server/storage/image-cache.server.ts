import { mkdir, readdir, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One app process owns the cache. Admission includes temporary-file allocation. */
export function createImageCache(directory: string, limits = { bytes: 1024 ** 3, files: 10_000, freeBytes: 128 * 1024 ** 2 }) {
  const entries = new Map<string, { bytes: number; used: number }>();
  let totalBytes = 0;
  let initialized = false;
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
  function setEntry(key: string, bytes: number, used: number) {
    totalBytes += bytes - (entries.get(key)?.bytes ?? 0);
    entries.set(key, { bytes, used });
  }
  function deleteEntry(key: string) {
    totalBytes -= entries.get(key)?.bytes ?? 0;
    entries.delete(key);
  }
  async function initialize() {
    if (initialized) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(directory)) {
      if (/^[a-f0-9]{64}\.image\.[a-f0-9-]+$/.test(file)) {
        await unlink(join(directory, file));
      } else if (/^[a-f0-9]{64}\.image$/.test(file)) {
        const info = await stat(join(directory, file));
        setEntry(file, info.size, info.mtimeMs);
      }
    }
    initialized = true;
    await trim(0, 0);
  }
  async function trim(bytes: number, files: number) {
    if (totalBytes + bytes <= limits.bytes && entries.size + files <= limits.files) return;
    for (const [key] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
      if (totalBytes + bytes <= limits.bytes && entries.size + files <= limits.files) break;
      await unlink(join(directory, key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      deleteEntry(key);
    }
  }
  return {
    get(key: string) {
      return serial(async () => {
        await initialize();
        try {
          const bytes = await readFile(join(directory, key));
          setEntry(key, bytes.byteLength, Date.now());
          return bytes;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          deleteEntry(key);
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
          setEntry(key, bytes.byteLength, Date.now());
          return true;
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      });
    },
  };
}
