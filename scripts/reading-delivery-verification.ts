// Actual-file regression and resource ownership receipt. No invented media or provider replies.
import { createReadingCache } from '$lib/reading/cache.server';
import { ComicDecoder } from '$lib/reading/reader/archive-decoder';
import { ZipReader, BlobReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { readdir, mkdir, writeFile, symlink, readFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const manifest = process.env.COAST_READING_ACTUAL_MANIFEST, output = process.env.COAST_READING_AUDIT_OUTPUT;
assert(manifest && output, 'Supply private actual document manifest and output paths.');
const documents = await Bun.file(manifest).json();
const working = join(dirname(resolve(output)), `delivery-${crypto.randomUUID()}`);
const extractor = process.env.COAST_READING_EXTRACTOR ?? resolve('.data/bin/reading-extractor');
const report: any = { boundary: 'Actual archived file replay on private temporary disk. No database/provider/browser timings or production admission claim for missing formats. Controlled leases/capacity/abort use exact original bytes.', source: Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim(), cases: [], samples: [] };
const pass = (name: string) => report.cases.push({ name, status: 'passed' });
const hash = async (path: string) => {
    const digest = new Bun.CryptoHasher('sha256');
    for await (const bytes of Bun.file(path).stream())
        digest.update(bytes);
    return digest.digest('hex');
};
let cache: ReturnType<typeof createReadingCache> | undefined;
let sampling: ReturnType<typeof setInterval> | undefined;
try {
    await mkdir(working, { recursive: true, mode: 0o700 });
    for (const input of documents) {
        assert(['cbr', 'cbz', 'cb7', 'cbt'].includes(input.format));
        assert.equal(Bun.file(input.file).size, input.bytes);
        assert.equal(await hash(input.file), input.sha256);
        let downloads = 0;
        const source = { key: input.sha256, edition: input.sha256, format: input.format, bytes: input.bytes, open: async () => {
                downloads++;
                return new Response(Bun.file(input.file));
            } };
        const root = join(working, input.sha256);
        cache = createReadingCache(root, extractor);
        Bun.gc(true);
        const cpu = process.cpuUsage(), beforeRss = process.memoryUsage().rss;
        let peakRss = beforeRss;
        sampling = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
        const start = performance.now();
        const [host, guest] = await Promise.all([cache.acquire('actual-host', source), cache.acquire('actual-guest', source)]);
        assert.equal(host, guest);
        try {
            await host.job;
        }
        finally {
            clearInterval(sampling);
        }
        if (host.error)
            throw host.error;
        const coldMs = performance.now() - start;
        const cpuUsed = process.cpuUsage(cpu);
        const resources = { mainCpuMicros: cpuUsed.user + cpuUsed.system, beforeRss, sampledPeakRss: Math.max(peakRss, process.memoryUsage().rss), boundary: 'Coordinator including sharp/hash/disk; sampled every 10ms, excludes native child CPU/RSS and browser. Not a process-tree peak or production memory bound.' };
        assert(host.manifest);
        assert.equal(downloads, 1);
        pass(`${input.format}: independent concurrent leases share one acquisition`);
        let baseline: any, zip: ZipReader<any> | undefined;
        if (input.format === 'cbz') {
            zip = new ZipReader(new BlobReader(Bun.file(input.file)));
            baseline = (await zip.getEntries()).filter((entry: any) => !entry.directory && /\.(png|jpe?g|webp|gif)$/i.test(entry.filename));
            baseline.sort((a: any, b: any) => new Intl.Collator('en', { numeric: true }).compare(a.filename, b.filename) || (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
        }
        else
            baseline = await ComicDecoder.open(await Bun.file(input.file).arrayBuffer(), input.format);
        try {
            const count = input.format === 'cbz' ? baseline.length : baseline.entries.length;
            assert.equal(host.manifest.pages.length, count);
            for (let index = 0; index < count; index++) {
                const page = await cache.page(host, index, new AbortController().signal);
                const actual = await hash(page.path);
                const original = input.format === 'cbz' ? await baseline[index].getData(new Uint8ArrayWriter(), { useWebWorkers: false, checkSignature: true }) : baseline.read(baseline.entries[index].index);
                assert.equal(actual, new Bun.CryptoHasher('sha256').update(original).digest('hex'));
            }
            pass(`${input.format}: every naturally ordered original page matches baseline bytes`);
        }
        finally {
            await zip?.close();
            if (input.format !== 'cbz')
                baseline.close();
        }
        await cache.release('actual-host');
        assert.equal(cache.snapshot().leases, 1);
        assert((await cache.page(guest, 0, new AbortController().signal)).bytes > 0);
        pass(`${input.format}: closing one party reader preserves another's files`);
        await cache.release('actual-guest');
        assert.equal(cache.snapshot().reserved, 0);
        assert.equal((await readdir(root)).length, 0);
        pass(`${input.format}: last-reader release removes temporary data and reservation`);
        const again = await cache.acquire('actual-host', source);
        assert(again.manifest, 'Exact-version manifest is retained without retaining archive/page bytes');
        const first = await cache.page(again, 0, new AbortController().signal);
        assert(first.bytes > 0);
        await again.job;
        if (again.error)
            throw again.error;
        assert.equal(downloads, 2);
        pass(`${input.format}: exact-version manifest supports verified page delivery during reacquisition`);
        report.samples.push({ format: input.format, bytes: input.bytes, sha256: input.sha256, pages: host.manifest.pages.length, coldPreparationMs: coldMs, resources, actualPageByteEquivalence: true });
        await cache.stop();
        cache = undefined;
    }
    const first = documents[0], source = { key: first.sha256, edition: first.sha256, format: first.format, bytes: first.bytes, open: async () => new Response(Bun.file(first.file)) };
    for (const limits of [{ bytes: first.bytes }, { metadataBytes: 1 }]) {
        cache = createReadingCache(join(working, crypto.randomUUID()), extractor, limits);
        const rejected = await cache.acquire('actual-capacity', source);
        await rejected.job;
        assert(rejected.error, 'Actual archive must fail the selected resource admission.');
        await cache.stop();
        assert.equal(cache.snapshot().reserved, 0);
        assert.equal(cache.snapshot().metadataBytes, 0);
        cache = undefined;
    }
    pass('actual source rejects disk/metadata capacity pressure and returns both reservations');
    const cancelled = join(working, 'cancelled');
    cache = createReadingCache(cancelled, extractor);
    const entry = await cache.acquire('actual-host', source);
    await cache.release('actual-host');
    await entry.job;
    assert.equal(cache.snapshot().reserved, 0);
    assert.equal((await readdir(cancelled)).length, 0);
    pass('actual-source cancellation drains extraction and deletes partial files');
    await cache.stop();
    cache = undefined;
    const orphan = join(working, 'orphans'), outside = join(working, 'retained-outside');
    await mkdir(orphan);
    await writeFile(outside, 'owned cleanup sentinel');
    await symlink(outside, join(orphan, `run-${crypto.randomUUID()}`));
    cache = createReadingCache(orphan, extractor);
    await cache.initialize();
    assert.equal(await readFile(outside, 'utf8'), 'owned cleanup sentinel');
    assert.equal((await readdir(orphan)).length, 0);
    pass('startup orphan cleanup removes its symlink without following its target');
    await cache.stop();
    cache = undefined;
    report.status = 'passed';
}
catch (cause) {
    report.status = 'failed';
    report.failure = String(cause);
    throw cause;
}
finally {
    clearInterval(sampling);
    await cache?.stop();
    await rm(working, { recursive: true, force: true });
    await Bun.write(output!, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
}
