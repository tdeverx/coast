import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageCache } from '../src/lib/server/storage/image-cache.server';

const key = (i: number) => i.toString(16).padStart(64, '0') + '.image';
async function restoreFile(directory: string, i: number, bytes: number) {
  const file = join(directory, key(i));
  await writeFile(file, new Uint8Array(bytes));
  await utimes(file, i, i);
}

test('image cache bounds concurrent admissions, deduplicates keys and restores its disk budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
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

test('image cache restores file-count and LRU limits and removes temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
  try {
    for (const i of [1, 2, 3]) await restoreFile(directory, i, 1);
    await writeFile(join(directory, `${key(4)}.abcdef-1234`), new Uint8Array(1));
    const cache = createImageCache(directory, { bytes: 100, files: 2, freeBytes: 0 });
    expect(await cache.get(key(0))).toBeNull();
    expect((await readdir(directory)).sort()).toEqual([key(2), key(3)]);
    expect((await cache.get(key(2)))?.byteLength).toBe(1);
    expect(await cache.put(key(4), new Uint8Array(1))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(2), key(4)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('image cache reconciles changed file sizes on repeated reads without double counting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
  try {
    await restoreFile(directory, 1, 4);
    await restoreFile(directory, 2, 4);
    const cache = createImageCache(directory, { bytes: 12, files: 3, freeBytes: 0 });
    await cache.get(key(1));
    await writeFile(join(directory, key(1)), new Uint8Array(8));
    for (let i = 0; i < 2; i++) expect((await cache.get(key(1)))?.byteLength).toBe(8);
    expect(await cache.put(key(3), new Uint8Array(4))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(1), key(3)]);
    await writeFile(join(directory, key(1)), new Uint8Array(2));
    for (let i = 0; i < 2; i++) expect((await cache.get(key(1)))?.byteLength).toBe(2);
    expect(await cache.put(key(4), new Uint8Array(6))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(1), key(3), key(4)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('image cache releases a missing file budget once when reads return ENOENT', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
  try {
    await restoreFile(directory, 1, 6);
    await restoreFile(directory, 2, 6);
    const cache = createImageCache(directory, { bytes: 12, files: 2, freeBytes: 0 });
    await cache.get(key(2));
    await unlink(join(directory, key(1)));
    expect(await cache.get(key(1))).toBeNull();
    expect(await cache.get(key(1))).toBeNull();
    expect(await cache.put(key(3), new Uint8Array(6))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(2), key(3)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('image cache releases a missing file budget during LRU eviction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
  try {
    for (const i of [1, 2, 3]) await restoreFile(directory, i, 4);
    const cache = createImageCache(directory, { bytes: 12, files: 3, freeBytes: 0 });
    await cache.get(key(3));
    await unlink(join(directory, key(1)));
    expect(await cache.put(key(4), new Uint8Array(4))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(2), key(3), key(4)]);
    expect(await cache.put(key(5), new Uint8Array(4))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(3), key(4), key(5)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('image cache accounts for externally restored files discovered by reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-image-cache-'));
  try {
    await restoreFile(directory, 1, 4);
    await restoreFile(directory, 2, 4);
    const cache = createImageCache(directory, { bytes: 12, files: 4, freeBytes: 0 });
    await cache.get(key(2));
    await restoreFile(directory, 3, 4);
    for (let i = 0; i < 2; i++) expect((await cache.get(key(3)))?.byteLength).toBe(4);
    expect(await cache.put(key(4), new Uint8Array(4))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([key(2), key(3), key(4)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
