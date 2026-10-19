import { mkdir, readdir, rm, statfs, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { ZipReader, BlobReader } from '@zip.js/zip.js';
import * as v from 'valibot';
import { dataDirectory } from '$lib/server/security/credentials';
import { AppError } from '$lib/server/security/errors';
import { readingManifestSchema, type ReadingManifest } from './delivery';
import type { ComicFormat } from './model';
import type { ReaderProgress } from './reader/load';
import { COMIC_EXPANDED_LIMIT, COMIC_PAGE_LIMIT, comicEntryName, comicImage, orderComicEntries } from './reader/comic-pages';
export type ReadingCacheSource = {
    key: string;
    edition: string;
    format: ComicFormat;
    bytes?: number;
    open(signal: AbortSignal): Promise<Response>;
};
type Page = {
    filename: string;
    index: number;
    size: number;
    width: number;
    height: number;
    hash: string;
    mime: string;
};
type Record = {
    manifest: ReadingManifest;
    pages: Page[];
    used: number;
};
export type ReadingCacheEntry = {
    controller: AbortController;
    directory: string;
    leases: Map<string, number>;
    listeners: Set<() => void>;
    pages: Map<string, Page>;
    manifest?: ReadingManifest;
    expected?: Record;
    expectedByName?: Map<string, Page>;
    error?: unknown;
    progress: ReaderProgress;
    finished: boolean;
    reserved: number;
    metadataBytes: number;
    job: Promise<void>;
    changed: number;
    idleUntil?: number;
};
const defaults = { bytes: 8 * 1024 ** 3, freeBytes: 512 * 1024 ** 2, preparations: 2, leases: 64, accountLeases: 8, idleMs: 30 * 60000, cacheEntries: 64, leaseMs: 180000, manifests: 64, manifestPages: 100000, manifestBytes: 16 * 1024 ** 2, metadataBytes: 32 * 1024 ** 2 };
/** One process owns temporary encoded pages; every HTTP caller still authorizes its session. */
export function createReadingCache(root: string, extractor: string, overrides: Partial<typeof defaults> = {}) {
    const limits = { ...defaults, ...overrides };
    const entries = new Map<string, ReadingCacheEntry>();
    const leases = new Map<string, ReadingCacheEntry>();
    const operations = new Map<string, object>();
    const records = new Map<string, Record>();
    const cleanup = new Set<Promise<void>>();
    let initialized: Promise<void> | undefined, stopped = false, preparing = 0, reserved = 0, metadataBytes = 0;
    const timer = setInterval(() => { void sweep().catch(() => { }); }, 30000);
    timer.unref();
    function notify(entry: ReadingCacheEntry) {
        entry.changed++;
        for (const listener of [...entry.listeners])
            listener();
    }
    async function initialize() {
        initialized ??= (async () => {
            await mkdir(root, { recursive: true, mode: 0o700 });
            for (const name of await readdir(root))
                if (/^run-[a-f0-9-]{36}$/.test(name))
                    await rm(join(root, name), { recursive: true, force: true });
        })();
        await initialized;
        if (stopped)
            throw new AppError(503, 'Reading delivery is stopping.');
    }
    function discard(entry: ReadingCacheEntry) {
        // Remove admission synchronously; another request cannot reuse an evicting entry.
        for (const [key, value] of entries)
            if (value === entry)
                entries.delete(key);
        entry.controller.abort(new DOMException('No active readers remain.', 'AbortError'));
        notify(entry);
        const removal = entry.job.finally(async () => {
            await rm(entry.directory, { recursive: true, force: true });
            reserved -= entry.reserved;
            entry.reserved = 0;
            metadataBytes -= entry.metadataBytes;
            entry.metadataBytes = 0;
        });
        cleanup.add(removal);
        void removal.finally(() => cleanup.delete(removal)).catch(() => { });
        return removal;
    }
    async function evictIdle() {
        const idle = [...entries.values()].filter(entry => !entry.leases.size && entry.finished && !entry.error)
            .sort((a, b) => (a.idleUntil ?? 0) - (b.idleUntil ?? 0))[0];
        if (!idle)
            return false;
        await discard(idle);
        return true;
    }
    function release(lease: string) {
        const entry = leases.get(lease);
        if (!entry)
            return Promise.resolve();
        leases.delete(lease);
        operations.delete(lease);
        entry.leases.delete(lease);
        if (!entry.leases.size) {
            if (!stopped && entry.finished && !entry.error && limits.idleMs > 0) {
                entry.idleUntil = Date.now() + limits.idleMs;
                if (entry.expected)
                    entry.expected.used = Date.now();
                return Promise.resolve();
            }
            return discard(entry);
        }
        return Promise.resolve();
    }
    function touch(lease: string) {
        const entry = leases.get(lease);
        if (entry)
            entry.leases.set(lease, Date.now() + limits.leaseMs);
    }
    /** A superseded HTTP request cannot cancel its session's newer delivery. */
    function claim(lease: string, entry: ReadingCacheEntry) {
        const owner = {};
        if (leases.get(lease) !== entry)
            return () => Promise.resolve();
        operations.set(lease, owner);
        return () => operations.get(lease) === owner ? release(lease) : Promise.resolve();
    }
    async function sweep() {
        for (const [lease, entry] of leases)
            if ((entry.leases.get(lease) ?? 0) <= Date.now())
                release(lease);
        for (const entry of [...entries.values()])
            if (!entry.leases.size && entry.idleUntil !== undefined && entry.idleUntil <= Date.now())
                void discard(entry).catch(() => { });
        for (const [key, record] of records)
            if (record.used < Date.now() - 30 * 60000)
                records.delete(key);
    }
    function remember(key: string, record: Record) {
        records.delete(key);
        records.set(key, record);
        let pages = [...records.values()].reduce((sum, value) => sum + value.pages.length, 0);
        let bytes = [...records.values()].reduce((sum, value) => sum + value.pages.reduce((total, page) => total + page.filename.length * 2 + 256, 0), 0);
        while (records.size > limits.manifests || pages > limits.manifestPages || bytes > limits.manifestBytes) {
            const oldest = records.keys().next().value!;
            const old = records.get(oldest)!;
            pages -= old.pages.length;
            bytes -= old.pages.reduce((sum, page) => sum + page.filename.length * 2 + 256, 0);
            records.delete(oldest);
        }
    }
    async function reserve(entry: ReadingCacheEntry, bytes: number) {
        if (bytes <= entry.reserved)
            return;
        const added = bytes - entry.reserved;
        if (!Number.isSafeInteger(bytes))
            throw new AppError(503, 'Reading temporary storage is full.');
        while (reserved + added > limits.bytes && await evictIdle()) { }
        if (reserved + added > limits.bytes)
            throw new AppError(503, 'Reading temporary storage is full. Close another reader and try again.');
        // Reserve synchronously before the filesystem await to fence concurrent preparations.
        reserved += added;
        entry.reserved = bytes;
        let space = await statfs(root);
        while (space.bavail * space.bsize < reserved + limits.freeBytes && await evictIdle())
            space = await statfs(root);
        // Count every reservation, including concurrent writers. Deliberately
        // conservative: materialized bytes are also already reflected by statfs.
        if (space.bavail * space.bsize < reserved + limits.freeBytes)
            throw new AppError(503, 'Reading temporary storage needs more free disk space.');
    }
    async function inspect(entry: ReadingCacheEntry, row: {
        slot: number;
        name: string;
        bytes: number;
    }) {
        if (!Number.isSafeInteger(row.slot) || row.slot < 0 || row.slot >= 10000 || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > COMIC_PAGE_LIMIT)
            throw new Error('Invalid extracted page metadata.');
        const filename = comicEntryName(row.name), path = join(entry.directory, `page-${row.slot}`);
        if (entry.pages.has(filename))
            throw new Error('Duplicate extracted page.');
        const charge = filename.length * 2 + 256;
        while (metadataBytes + charge > limits.metadataBytes && await evictIdle()) { }
        if (metadataBytes + charge > limits.metadataBytes)
            throw new AppError(503, 'Reading manifest capacity is full. Close another reader and try again.');
        metadataBytes += charge;
        entry.metadataBytes += charge;
        // Do not dispatch extension-disguised SVG/PDF/etc. to a broader image loader.
        const prefix = new Uint8Array(await Bun.file(path).slice(0, 12).arrayBuffer());
        const signature = (bytes: number[], at = 0) => bytes.every((byte, index) => prefix[at + index] === byte);
        const format = signature([0xff, 0xd8, 0xff]) ? 'jpeg'
            : signature([137, 80, 78, 71, 13, 10, 26, 10]) ? 'png'
                : signature([71, 73, 70, 56, 55, 97]) || signature([71, 73, 70, 56, 57, 97]) ? 'gif'
                    : signature([82, 73, 70, 70]) && signature([87, 69, 66, 80], 8) ? 'webp' : undefined;
        if (!format)
            throw new Error('Unsupported comic image.');
        const { default: sharp } = await import('sharp');
        const metadata = await sharp(path, { limitInputPixels: 32 * 1024 ** 2, pages: 1 }).metadata();
        if (metadata.format !== format)
            throw new Error('Unsupported comic image.');
        const { width, height } = metadata.autoOrient;
        if (!width || !height || width * height > 32 * 1024 ** 2)
            throw new Error('Comic image exceeds the pixel limit.');
        const scale = Math.min(1, 2048 / Math.max(width, height));
        const digest = new Bun.CryptoHasher('sha256');
        const stream = Bun.file(path).stream().getReader();
        let size = 0;
        try {
            for (;;) {
                entry.controller.signal.throwIfAborted();
                const chunk = await stream.read();
                if (chunk.done)
                    break;
                size += chunk.value.byteLength;
                if (size > row.bytes)
                    throw new Error('Extracted page exceeds its verified size.');
                digest.update(chunk.value);
            }
        }
        finally {
            await stream.cancel().catch(() => { });
            stream.releaseLock();
        }
        if (size !== row.bytes)
            throw new Error('Extracted page is incomplete.');
        const page: Page = { filename, index: row.slot, size, width: Math.round(width * scale), height: Math.round(height * scale), hash: digest.digest('hex'), mime: `image/${metadata.format}` };
        const expected = entry.expectedByName?.get(filename);
        if (entry.expected && (!expected || expected.hash !== page.hash || expected.width !== page.width || expected.height !== page.height || expected.size !== page.size))
            throw new Error('The cached reading manifest no longer matches this file.');
        entry.pages.set(filename, page);
        if (entry.progress.phase === 'inspect')
            entry.progress = { ...entry.progress, loaded: entry.pages.size };
        notify(entry);
    }
    async function prepare(entry: ReadingCacheEntry, source: ReadingCacheSource) {
        const signal = entry.controller.signal, archivePath = join(entry.directory, 'archive');
        let child: ReturnType<typeof spawn> | undefined, archive: Awaited<ReturnType<typeof open>> | undefined;
        let metadataWork: Promise<void> | undefined, exit: Promise<number> | undefined, stderr: Promise<string> | undefined;
        let expanded = 0, complete = false, downloaded = 0, previousNotice = 0;
        let childFinished = false;
        const launch = (seekable: boolean) => {
            child = spawn(extractor, [source.format, entry.directory, ...(seekable ? [archivePath] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
            const current = child;
            exit = new Promise((resolve, reject) => {
                current.once('error', reject);
                current.once('close', code => resolve(code ?? -1));
            });
            void exit.then(code => {
                childFinished = true;
                if (code !== 0)
                    entry.controller.abort(new Error('Archive extraction failed.'));
            }, cause => {
                childFinished = true;
                entry.controller.abort(cause);
            });
            current.stdin!.on('error', () => { });
            stderr = (async () => {
                let message = '';
                for await (const chunk of current.stderr!) {
                    if (message.length + chunk.length > 8192)
                        throw new Error('Extractor error output exceeded its limit.');
                    message += chunk.toString();
                }
                return message;
            })();
            void stderr.catch(() => { });
            metadataWork = (async () => {
                const reader = (Readable.toWeb(current.stdout!) as unknown as ReadableStream<Uint8Array>).getReader();
                const decoder = new TextDecoder('utf-8', { fatal: true });
                let pending = '';
                try {
                    for (;;) {
                        const part = await reader.read();
                        pending += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
                        let newline: number;
                        while ((newline = pending.indexOf('\n')) >= 0) {
                            if (newline > 16384 || complete)
                                throw new Error('Invalid extractor metadata.');
                            const row = JSON.parse(pending.slice(0, newline));
                            pending = pending.slice(newline + 1);
                            if (row.done === true) {
                                complete = true;
                                expanded = row.expanded;
                            }
                            else
                                await inspect(entry, row);
                        }
                        if (pending.length > 16384)
                            throw new Error('Extractor metadata exceeded its limit.');
                        if (part.done)
                            break;
                    }
                    if (pending.trim())
                        throw new Error('Incomplete extractor metadata.');
                }
                finally {
                    reader.releaseLock();
                }
            })();
            void metadataWork.catch(cause => entry.controller.abort(cause));
            signal.addEventListener('abort', () => current.kill('SIGKILL'), { once: true });
            if (signal.aborted)
                current.kill('SIGKILL');
        };
        try {
            await mkdir(entry.directory, { mode: 0o700 });
            await reserve(entry, (source.bytes ?? 0) + COMIC_EXPANDED_LIMIT);
            signal.throwIfAborted();
            archive = await open(archivePath, 'wx', 0o600);
            if (source.format !== 'cb7')
                launch(false);
            const response = await source.open(signal);
            if (!response.ok || !response.body) {
                await response.body?.cancel();
                throw new Error('Reading source download failed.');
            }
            const declared = Number(response.headers.get('content-length'));
            const total = Number.isSafeInteger(declared) && declared > 0 ? declared : undefined;
            if (source.bytes !== undefined && total !== undefined && source.bytes !== total) {
                await response.body.cancel();
                throw new Error('Reading source size changed.');
            }
            if (total !== undefined)
                await reserve(entry, total + COMIC_EXPANDED_LIMIT);
            const reader = response.body.getReader();
            try {
                for (;;) {
                    signal.throwIfAborted();
                    const part = await reader.read();
                    if (part.done)
                        break;
                    downloaded += part.value.byteLength;
                    if (total !== undefined && downloaded > total)
                        throw new Error('Reading download exceeds its declared size.');
                    await reserve(entry, downloaded + COMIC_EXPANDED_LIMIT);
                    let written = 0;
                    while (written < part.value.byteLength) {
                        const result = await archive.write(part.value, written);
                        if (!result.bytesWritten)
                            throw new Error('Reading cache write made no progress.');
                        written += result.bytesWritten;
                    }
                    if (child && !childFinished) {
                        await new Promise<void>((resolve, reject) => {
                            const timer = setTimeout(() => reject(new Error('Reading extraction stopped making progress.')), 30000);
                            child!.stdin!.write(part.value, cause => {
                                clearTimeout(timer);
                                cause ? reject(cause) : resolve();
                            });
                        }).catch(async (cause) => {
                            if ((cause as NodeJS.ErrnoException).code !== 'EPIPE' || await exit !== 0)
                                throw cause;
                            childFinished = true;
                        });
                    }
                    entry.progress = { phase: 'download', loaded: downloaded, total };
                    if (performance.now() - previousNotice > 250) {
                        previousNotice = performance.now();
                        notify(entry);
                    }
                }
            }
            finally {
                await reader.cancel().catch(() => { });
                reader.releaseLock();
            }
            if (total !== undefined && total !== downloaded || source.bytes !== undefined && source.bytes !== downloaded)
                throw new Error('Reading download is incomplete.');
            await archive.close();
            archive = undefined;
            if (source.format === 'cb7')
                launch(true);
            else if (!childFinished)
                child!.stdin!.end();
            entry.progress = { phase: 'inspect', loaded: entry.pages.size, total: entry.expected?.pages.length };
            notify(entry);
            const code = await exit;
            const message = await stderr;
            await metadataWork;
            signal.throwIfAborted();
            if (code !== 0 || !complete || !Number.isSafeInteger(expanded) || expanded > COMIC_EXPANDED_LIMIT)
                throw new Error(message || 'Archive extraction failed.');
            const pages = orderComicEntries([...entry.pages.values()]);
            if (source.format === 'cbz') {
                const zip = new ZipReader(new BlobReader(Bun.file(archivePath)));
                try {
                    const indexed = new Map<string, number>();
                    let declared = 0, count = 0;
                    for await (const item of zip.getEntriesGenerator()) {
                        signal.throwIfAborted();
                        declared += item.uncompressedSize;
                        const name = comicEntryName(item.filename);
                        if (++count > 10000 || !Number.isSafeInteger(item.uncompressedSize) || item.uncompressedSize < 0 || declared > COMIC_EXPANDED_LIMIT || indexed.has(name) || item.encrypted)
                            throw new Error('Invalid ZIP central directory.');
                        indexed.set(name, item.uncompressedSize);
                    }
                    const selected = [...indexed.keys()].filter(name => comicImage(name) && !name.endsWith('/'));
                    if (selected.length !== pages.length || pages.some(page => indexed.get(page.filename) !== page.size))
                        throw new Error('ZIP entry metadata disagrees with streamed output.');
                }
                finally {
                    await zip.close();
                }
            }
            const manifest = v.parse(readingManifestSchema, { version: 1, edition: source.edition, format: source.format, pages: pages.map(page => ({ width: page.width, height: page.height, bytes: page.size })) });
            if (entry.expected && (entry.expected.pages.length !== pages.length || entry.expected.pages.some((page, index) => page.filename !== pages[index].filename)))
                throw new Error('Reading archive order changed.');
            const record = { manifest, pages, used: Date.now() };
            entry.expected = record;
            remember(source.key, record);
            entry.manifest = manifest;
            await unlink(archivePath);
            const used = pages.reduce((sum, page) => sum + page.size, 0);
            reserved -= entry.reserved - used;
            entry.reserved = used;
            entry.finished = true;
            notify(entry);
        }
        catch (cause) {
            entry.error = cause;
            entry.controller.abort(cause);
            entry.finished = true;
            records.delete(source.key);
            notify(entry);
            // A failed cache is never used as an implicit browser whole-file fallback.
            for (const lease of [...entry.leases.keys()])
                release(lease);
        }
        finally {
            child?.kill('SIGKILL');
            await Promise.allSettled([metadataWork, stderr, exit]);
            await archive?.close().catch(() => { });
            preparing--;
        }
    }
    function checkAdmission(lease: string) {
        // HTTP callers use readingLease's validated account:session identity.
        const account = lease.split(':', 1)[0];
        if (!leases.has(lease) && [...leases.keys()].filter(key => key.split(':', 1)[0] === account).length >= limits.accountLeases)
            throw new AppError(503, 'Too many active readers for your account. Close another reader and try again.');
        if (!leases.has(lease) && leases.size >= limits.leases)
            throw new AppError(503, 'Too many active reading deliveries.');
    }
    async function acquire(lease: string, source: ReadingCacheSource) {
        await initialize();
        await sweep();
        checkAdmission(lease);
        let entry = entries.get(source.key);
        if (!entry && entries.size >= limits.cacheEntries) {
            while (!entries.has(source.key) && entries.size >= limits.cacheEntries && await evictIdle())
                checkAdmission(lease);
            // Eviction yields: another request can consume the account's remaining slot.
            checkAdmission(lease);
            entry = entries.get(source.key);
            if (!entry && entries.size >= limits.cacheEntries)
                throw new AppError(503, 'Reading cache capacity is full. Try again shortly.');
        }
        if (!entry) {
            if (preparing >= limits.preparations)
                throw new AppError(503, 'Reading preparation is busy. Try again shortly.');
            entry = { controller: new AbortController(), directory: join(root, `run-${crypto.randomUUID()}`), leases: new Map(), listeners: new Set(), pages: new Map(), progress: { phase: 'prepare' }, finished: false, reserved: 0, metadataBytes: 0, job: Promise.resolve(), changed: 0 };
            const prior = records.get(source.key);
            if (prior) {
                prior.used = Date.now();
                entry.expected = prior;
                entry.expectedByName = new Map(prior.pages.map(page => [page.filename, page]));
                entry.manifest = prior.manifest;
            }
            entries.set(source.key, entry);
            preparing++;
            // Start after publishing the job identity so release/failure finally cannot race it.
            const owned = entry;
            entry.job = Promise.resolve().then(() => prepare(owned, source));
        }
        const previous = leases.get(lease);
        if (previous && previous !== entry)
            release(lease);
        entry.idleUntil = undefined;
        if (entry.expected) {
            entry.expected.used = Date.now();
            remember(source.key, entry.expected);
        }
        leases.set(lease, entry);
        operations.set(lease, {});
        touch(lease);
        return entry;
    }
    async function wait(entry: ReadingCacheEntry, changed: number, signal: AbortSignal) {
        signal.throwIfAborted();
        if (entry.changed !== changed || entry.finished || entry.controller.signal.aborted)
            return;
        await new Promise<void>((resolve, reject) => {
            const done = () => {
                cleanup();
                resolve();
            };
            const abort = () => {
                cleanup();
                reject(signal.reason);
            };
            const cleanup = () => {
                entry.listeners.delete(done);
                signal.removeEventListener('abort', abort);
            };
            entry.listeners.add(done);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted)
                abort();
            else if (entry.changed !== changed || entry.finished || entry.controller.signal.aborted)
                done();
        });
    }
    async function page(entry: ReadingCacheEntry, index: number, signal: AbortSignal) {
        if (!Number.isSafeInteger(index) || index < 0 || !entry.manifest || index >= entry.manifest.pages.length)
            throw new AppError(404, 'Reading page not found.');
        const expected = entry.expected?.pages[index];
        if (!expected)
            throw new AppError(404, 'Reading page not found.');
        for (;;) {
            signal.throwIfAborted();
            const changed = entry.changed;
            if (entry.error)
                throw new AppError(422, 'This reading archive could not be prepared.');
            entry.controller.signal.throwIfAborted();
            const found = entry.pages.get(expected.filename);
            if (found)
                return { path: join(entry.directory, `page-${found.index}`), bytes: found.size, mime: found.mime };
            if (entry.finished)
                throw new AppError(404, 'Reading page not found.');
            await wait(entry, changed, signal);
        }
    }
    async function stop() {
        stopped = true;
        clearInterval(timer);
        const jobs = [...entries.values()].map(entry => entry.job);
        for (const lease of [...leases.keys()])
            release(lease);
        for (const entry of [...entries.values()])
            discard(entry);
        await Promise.allSettled([...jobs, ...cleanup]);
        records.clear();
    }
    const prepared = (key: string) => {
        const entry = entries.get(key);
        return entry?.finished && !entry.error ? entry : undefined;
    };
    return { acquire, release, claim, touch, wait, page, stop, initialize, prepared, snapshot: () => ({ entries: entries.size, leases: leases.size, preparing, reserved, metadataBytes, manifests: records.size }) };
}
type Cache = ReturnType<typeof createReadingCache>;
const key = Symbol.for('coast.reading.delivery');
const state = globalThis as typeof globalThis & {
    [key]?: {
        cache?: Cache;
        closing?: Promise<void>;
        stopping?: boolean;
    };
};
const owner = state[key] ??= {};
export async function readingCache() {
    await owner.closing;
    if (owner.stopping)
        throw new AppError(503, 'Reading delivery is stopping.');
    const extractor = process.env.COAST_READING_EXTRACTOR ?? (import.meta.env.PROD ? join(process.cwd(), 'build/reading-extractor') : join(dataDirectory(), 'bin/reading-extractor'));
    return owner.cache ??= createReadingCache(process.env.COAST_READING_CACHE_DIRECTORY ?? join(dataDirectory(), 'reading-cache'), extractor);
}
export async function initializeReadingCache() {
    owner.stopping = false;
    await (await readingCache()).initialize();
}
export async function stopReadingCache() {
    owner.stopping = true;
    const cache = owner.cache;
    owner.cache = undefined;
    if (cache)
        owner.closing = cache.stop();
    await owner.closing;
}
export const readingLease = (userId: string, sessionId: string) => `${userId}:${sessionId}`;
