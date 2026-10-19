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
    const directory = join(root, crypto.randomUUID()), cache = createReadingCache(directory, extractor, { idleMs: 0, ...limits });
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
    const directory = join(root, crypto.randomUUID()), cache = createReadingCache(directory, extractor, { leaseMs: 5, manifests: 1, idleMs: 0 });
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
        input.open = async () => new Response(new ReadableStream({ start(stream) {
                // The admission assertion can abort before the async job opens its body.
                if (controller.signal.aborted)
                    stream.error(controller.signal.reason);
                else
                    controller.signal.addEventListener('abort', () => stream.error(controller.signal.reason), { once: true });
            } }));
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
    }
    finally {
        await cache.stop();
    }
});
nativeTest('concurrent preparations account for combined outstanding free-space reservations', async () => {
    const { statfs } = await import('node:fs/promises');
    const directory = join(root, crypto.randomUUID());
    const data = tarComic({ 'page.png': png }), reservation = data.byteLength + 512 * 1024 ** 2;
    const space = await statfs(root), available = space.bavail * space.bsize;
    expect(available).toBeGreaterThan(reservation * 2);
    const cache = createReadingCache(directory, extractor, { freeBytes: available - Math.floor(reservation * 1.5) });
    try {
        const [first, second] = await Promise.all([cache.acquire('first', source(data)), cache.acquire('second', source(data))]);
        await Promise.all([first.job, second.job]);
        expect(Boolean(first.error) || Boolean(second.error)).toBe(true);
    }
    finally {
        await cache.stop();
    }
    expect(cache.snapshot().reserved).toBe(0);
});
nativeTest('slow real metadata completion advances inspect progress instead of repeating its initial count', async () => {
    const original = sharp.prototype.metadata;
    (sharp.prototype as any).metadata = async function (...args: unknown[]) {
        await Bun.sleep(10);
        return (original as any).apply(this, args);
    };
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor), values: number[] = [];
    try {
        const files = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`page${index}.png`, png]));
        const entry = await cache.acquire('reader', source(tarComic(files)));
        entry.listeners.add(() => {
            if (entry.progress.phase === 'inspect')
                values.push(entry.progress.loaded ?? 0);
        });
        await entry.job;
        expect(entry.error).toBeUndefined();
        expect(values.at(-1)).toBe(20);
        expect(new Set(values).size).toBeGreaterThan(1);
    }
    finally {
        (sharp.prototype as any).metadata = original;
        await cache.stop();
    }
});
nativeTest('one account cannot consume the shared lease pool; renewal and independent readers remain admitted', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor);
    try {
        const input = source(tarComic({ 'page.png': png }));
        const entry = await cache.acquire('account-a:0', input);
        await entry.job;
        for (let index = 1; index < 8; index++)
            await cache.acquire(`account-a:${index}`, input);
        await expect(cache.acquire('account-a:8', input)).rejects.toThrow('Too many active readers for your account');
        expect(await cache.acquire('account-a:0', input)).toBe(entry);
        expect(await cache.acquire('account-b:0', input)).toBe(entry);
        expect(cache.snapshot().leases).toBe(9);
        await cache.release('account-a:0');
        expect(await cache.acquire('account-a:8', input)).toBe(entry);
    }
    finally {
        await cache.stop();
    }
});
nativeTest('reopening and independent account sessions use global capacity without a restrictive account preparation gate', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor);
    let unlock!: () => void;
    const gate = new Promise<void>(resolve => { unlock = resolve; });
    try {
        const input = source(tarComic({ 'page.png': png }));
        input.open = async () => {
            await gate;
            return new Response(tarComic({ 'page.png': png }));
        };
        const first = await cache.acquire('account-a:0', input);
        expect(await cache.acquire('account-a:2', input)).toBe(first);
        const other = await cache.acquire('account-a:1', { ...input, key: 'another' });
        expect(await cache.acquire('account-b:0', input)).toBe(first);
        await cache.release('account-a:0');
        expect(await cache.acquire('account-a:reopened', input)).toBe(first);
        await expect(cache.acquire('account-a:third', { ...input, key: 'third' })).rejects.toThrow('busy');
        unlock();
        await Promise.all([first.job, other.job]);
        expect(first.error).toBeUndefined();
        expect(other.error).toBeUndefined();
    }
    finally {
        unlock();
        await cache.stop();
    }
});
nativeTest('completed pages remain shared after the final lease closes, then expire without active eviction', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor, { idleMs: 1000 });
    const input = source(tarComic({ 'page.png': png }));
    let downloads = 0;
    input.open = async () => {
        downloads++;
        return new Response(tarComic({ 'page.png': png }));
    };
    try {
        const first = await cache.acquire('account-a:first', input);
        await first.job;
        await cache.release('account-a:first');
        expect(cache.snapshot().leases).toBe(0);
        expect(cache.snapshot().entries).toBe(1);
        const guest = await cache.acquire('account-b:guest', input);
        expect(guest).toBe(first);
        expect(downloads).toBe(1);
        first.idleUntil = Date.now() - 1;
        expect(await cache.acquire('account-b:guest', input)).toBe(first);
        await cache.release('account-b:guest');
        first.idleUntil = Date.now() - 1;
        const renewed = await cache.acquire('account-a:reopened', input);
        expect(renewed).not.toBe(first);
        await renewed.job;
        expect(downloads).toBe(2);
        expect(first.controller.signal.aborted).toBe(true);
    }
    finally {
        await cache.stop();
    }
});
nativeTest('cache entry pressure evicts idle pages while retaining an active reader', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor, { cacheEntries: 2 });
    try {
        const a = await cache.acquire('a:first', source(tarComic({ 'page.png': png })));
        await a.job;
        await cache.release('a:first');
        const b = await cache.acquire('b:first', source(tarComic({ 'page.png': png })));
        await b.job;
        const c = await cache.acquire('c:first', source(tarComic({ 'page.png': png })));
        await c.job;
        expect(a.controller.signal.aborted).toBe(true);
        expect(b.controller.signal.aborted).toBe(false);
        expect(c.error).toBeUndefined();
        expect(cache.snapshot().entries).toBe(2);
    }
    finally {
        await cache.stop();
    }
});
nativeTest('idle page eviction returns disk and metadata capacity before admitting new work', async () => {
    for (const limits of [{ bytes: 512 * 1024 ** 2 + tarComic({ 'page.png': png }).byteLength }, { metadataBytes: 280 }]) {
        const cache = createReadingCache(join(root, crypto.randomUUID()), extractor, limits);
        try {
            const first = await cache.acquire('a:one', source(tarComic({ 'page.png': png })));
            await first.job;
            expect(first.error).toBeUndefined();
            await cache.release('a:one');
            const second = await cache.acquire('b:two', source(tarComic({ 'page.png': png })));
            await second.job;
            expect(second.error).toBeUndefined();
            expect(first.controller.signal.aborted).toBe(true);
        }
        finally {
            await cache.stop();
        }
    }
});
nativeTest('concurrent idle eviction rechecks account admission before starting a job', async () => {
    const cache = createReadingCache(join(root, crypto.randomUUID()), extractor, { cacheEntries: 2, accountLeases: 1 });
    try {
        for (let index = 0; index < 2; index++) {
            const entry = await cache.acquire(`seed:${index}`, source(tarComic({ 'page.png': png })));
            await entry.job;
            await cache.release(`seed:${index}`);
        }
        let downloads = 0;
        const contender = () => ({ ...source(tarComic({ 'page.png': png })), open: async () => {
                downloads++;
                return new Response(tarComic({ 'page.png': png }));
            } });
        const results = await Promise.allSettled([cache.acquire('account:first', contender()), cache.acquire('account:second', contender())]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(cache.snapshot().leases).toBe(1);
        for (const result of results)
            if (result.status === 'fulfilled')
                await result.value.job;
        expect(downloads).toBe(1);
    }
    finally {
        await cache.stop();
    }
});
