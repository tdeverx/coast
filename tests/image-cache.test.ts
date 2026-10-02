import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageCache } from '../src/lib/server/storage/image-cache.server';

test('image cache bounds concurrent admissions, deduplicates keys and restores its disk budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
  const key = (i: number) => i.toString(16).padStart(64, '0') + '.image';
  try {
    const cache = createImageCache(directory, { bytes: 12, files: 2, freeBytes: 0 });
    await Promise.all([cache.put(key(1), new Uint8Array(8)), cache.put(key(1), new Uint8Array(8)), cache.put(key(2), new Uint8Array(8))]);
    expect((await readdir(directory)).length).toBe(1);
    expect((await cache.get(key(2)))?.byteLength).toBe(8);
    expect(await cache.put(key(3), new Uint8Array(13))).toBe(false);
    expect((await cache.get(key(2)))?.byteLength).toBe(8);
    await writeFile(join(directory, key(4)), new Uint8Array(8));
    const restored = createImageCache(directory, { bytes: 12, files: 2, freeBytes: 0 });
    await restored.get(key(4));
    expect((await readdir(directory)).length).toBe(1);
    const noSpace = createImageCache(directory, { bytes: 12, files: 2, freeBytes: Number.MAX_SAFE_INTEGER });
    expect(await noSpace.put(key(5), new Uint8Array(2))).toBe(false);
    expect((await readdir(directory)).some(file => file.includes('.image.'))).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
