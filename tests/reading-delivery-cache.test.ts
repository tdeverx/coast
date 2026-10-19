import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createReadingCache } from '../src/lib/reading/cache.server';
import { rarComic, tarComic } from './fixtures/comic-archives';
import { ZipWriter, BlobWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import sharp from 'sharp';
const extractor = process.env.COAST_READING_EXTRACTOR ?? resolve('.data/bin/reading-extractor');
const nativeTest = await Bun.file(extractor).exists() ? test : test.skip;
let root: string;
let png: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'coast-reading-contract-'));
    png = new Uint8Array(await sharp({ create: { width: 18, height: 30, channels: 3, background: 'white' } }).png().toBuffer());
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
const source = (data: ArrayBuffer | Uint8Array, format: 'cbt' | 'cbr' | 'cbz' = 'cbt') => ({ key: crypto.randomUUID(), edition: 'a'.repeat(64), format, bytes: data.byteLength, open: async () => new Response(data as ArrayBuffer | Uint8Array<ArrayBuffer>) });
async function fixture(data: ArrayBuffer | Uint8Array, format: 'cbt' | 'cbr' | 'cbz' = 'cbt', limits = {}) {
    const directory = join(root, crypto.randomUUID()), cache = createReadingCache(directory, extractor, limits);
    const entry = await cache.acquire('reader', source(data, format));
    await entry.job;
    return { cache, entry, directory };
}
// Authored boundary fixtures supplement the separate actual-file acceptance corpus.
for (const format of ['cbt', 'cbr', 'cbz'] as const)
    nativeTest(`server ${format}: metadata, original bytes and lifecycle ownership`, async () => {
        const files = { 'page10.png': png, 'page2.png': png };
        let data: ArrayBuffer | Uint8Array;
        if (format === 'cbz') {
            const writer = new ZipWriter(new BlobWriter());
            for (const [name, bytes] of Object.entries(files))
                await writer.add(name, new Uint8ArrayReader(bytes));
            data = await (await writer.close()).arrayBuffer();
        }
        else
            data = format === 'cbr' ? rarComic(files) : tarComic(files);
        const { cache, entry, directory } = await fixture(data, format);
        try {
            expect(entry.error).toBeUndefined();
            expect(entry.manifest?.pages).toEqual([{ width: 18, height: 30, bytes: png.length }, { width: 18, height: 30, bytes: png.length }]);
            const page = await cache.page(entry, 0, new AbortController().signal);
            expect(new Uint8Array(await Bun.file(page.path).arrayBuffer())).toEqual(png);
            await cache.release('reader');
            expect(await readdir(directory)).toEqual([]);
            expect(cache.snapshot().reserved).toBe(0);
            expect(cache.snapshot().metadataBytes).toBe(0);
        }
        finally {
            await cache.stop();
        }
    });
for (const [name, files] of [
    ['traversal', { '../page.png': new Uint8Array([1]) }],
    ['duplicate normalized paths', { 'x\\page.png': new Uint8Array([1]), 'x/page.png': new Uint8Array([1]) }],
    ['SVG disguised as JPEG', { 'page.jpg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') }],
    ['page byte limit', { 'page.png': new Uint8Array(32 * 1024 ** 2 + 1) }],
] as const)
    nativeTest(`server extraction rejects ${name} and cleans up`, async () => {
        const { cache, entry, directory } = await fixture(tarComic(files));
        try {
            expect(entry.error).toBeDefined();
            await cache.stop();
            expect(await readdir(directory)).toEqual([]);
            expect(cache.snapshot().reserved).toBe(0);
        }
        finally {
            await cache.stop();
        }
    });
nativeTest('server metadata preserves oriented dimensions and rounds exactly like browser raster sizing', async () => {
    const oriented = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: 'white' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { cache, entry } = await fixture(tarComic({ 'page.jpg': oriented }));
    try {
        expect(entry.error).toBeUndefined();
        expect(entry.manifest?.pages[0]).toEqual({ width: 1024, height: 2048, bytes: oriented.length });
    }
    finally {
        await cache.stop();
    }
});
nativeTest('global disk/metadata limits reject explicitly and release all reservations', async () => {
    for (const limits of [{ bytes: 1 }, { metadataBytes: 1 }, { freeBytes: Number.MAX_SAFE_INTEGER }]) {
        const { cache, entry } = await fixture(tarComic({ 'page.png': png }), 'cbt', limits);
        try {
            expect(entry.error).toBeDefined();
            await cache.stop();
            expect(cache.snapshot().reserved).toBe(0);
            expect(cache.snapshot().metadataBytes).toBe(0);
        }
        finally {
            await cache.stop();
        }
    }
});
nativeTest('idle expiry releases only stale leases; retained manifests obey count budget', async () => {
    const directory = join(root, crypto.randomUUID()), cache = createReadingCache(directory, extractor, { leaseMs: 5, manifests: 1 });
    try {
        const original = source(tarComic({ 'page.png': png }));
        const first = await cache.acquire('first', original);
        await first.job;
        await Bun.sleep(10);
        const next = await cache.acquire('next', source(tarComic({ 'page.png': png })));
        await next.job;
        expect(cache.snapshot().leases).toBe(1);
        expect(cache.snapshot().manifests).toBe(1);
        expect(first.controller.signal.aborted).toBe(true);
    }
    finally {
        await cache.stop();
    }
    expect(await readdir(directory)).toEqual([]);
});
nativeTest('preparation admission and waiting-page cancellation do not queue unbounded jobs', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor, { preparations: 1 });
    const controller = new AbortController();
    try {
        const input = source(tarComic({ 'page.png': png }));
        input.open = async () => new Response(new ReadableStream({ start(stream) { controller.signal.addEventListener('abort', () => stream.error(controller.signal.reason), { once: true }); } }));
        const first = await cache.acquire('first', input);
        await expect(cache.acquire('second', source(tarComic({ 'page.png': png })))).rejects.toThrow('busy');
        const waiting = cache.wait(first, first.changed, controller.signal);
        controller.abort();
        await expect(waiting).rejects.toThrow();
        expect(first.listeners.size).toBe(0);
    }
    finally {
        controller.abort();
        await cache.stop();
    }
});
nativeTest('ZIP central index cannot introduce a page absent from streamed extraction', async () => {
    const writer = new ZipWriter(new BlobWriter());
    await writer.add('page.png', new Uint8ArrayReader(png), { level: 0 });
    await writer.add('.hidden.png', new Uint8ArrayReader(png), { level: 0 });
    const data = new Uint8Array(await (await writer.close()).arrayBuffer());
    const marker = new TextEncoder().encode('.hidden.png'), replacement = new TextEncoder().encode('visible.png');
    let changed = false;
    for (let offset = 0; offset + 46 < data.length; offset++) {
        if (data[offset] === 0x50 && data[offset + 1] === 0x4b && data[offset + 2] === 1 && data[offset + 3] === 2 && marker.every((byte, index) => data[offset + 46 + index] === byte)) {
            data.set(replacement, offset + 46);
            changed = true;
            break;
        }
    }
    expect(changed).toBe(true);
    const { cache, entry } = await fixture(data, 'cbz');
    try {
        expect(entry.error).toBeDefined();
    }
    finally {
        await cache.stop();
    }
});
nativeTest('superseded manifest cleanup cannot cancel a newer request on the same session', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor);
    try {
        const input = source(tarComic({ 'page.png': png }));
        const original = await cache.acquire('same-session', input);
        const cancelOldRequest = cache.claim('same-session', original);
        const current = await cache.acquire('same-session', input);
        cache.claim('same-session', current);
        await cancelOldRequest();
        expect(cache.snapshot().leases).toBe(1);
        expect(current.controller.signal.aborted).toBe(false);
        await current.job;
        expect(current.error).toBeUndefined();
    } finally { await cache.stop(); }
});
