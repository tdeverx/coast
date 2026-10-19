import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { ReadingFormat } from '../src/lib/reading/model';
import { verifyReadingRenderer, verifyReadingTurns, compareReadingEntry, verifyReadingPadding } from './fixtures/reading-renderer';
// Replays authorized actual files. This never invents catalogue/provider data,
// provisions a login, uploads content or writes progress. Acquisition is separate.
const manifest = process.env.COAST_READING_ACTUAL_MANIFEST;
const output = process.env.COAST_READING_AUDIT_OUTPUT;
const baseline = process.env.COAST_READING_BASELINE_MODULE;
const origin = process.env.COAST_READING_AUDIT_ORIGIN ?? 'http://localhost:5173';
const rounds = Number(process.env.COAST_READING_AUDIT_ROUNDS ?? 4);
// The raster audit defaults to the explicit preserve-all opt-out policy.
// Set true to compare the app's default sanitization with the original policy.
const sanitizeOddPages = process.env.COAST_READING_SANITIZE_ODD_PAGES === 'true';
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 8, 'Use one to eight alternating rounds.');
assert(manifest && output && baseline, 'Supply a private actual-file manifest, output path and frozen baseline module.');
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Use a local development server.');
assert(baseline.startsWith('/src/lib/reading/'), 'Serve only the temporary source-only baseline through Vite.');
type Input = {
    file: string;
    sha256: string;
    format: ReadingFormat;
    kind: 'book' | 'comic';
    bytes: number;
};
const inputs: Input[] = JSON.parse(await readFile(manifest, 'utf8'));
assert(inputs.length && inputs.length <= 8, 'Choose one to eight actual documents.');
for (const input of inputs) {
    const file = Bun.file(input.file);
    assert.equal(file.size, input.bytes);
    assert.equal(new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex'), input.sha256);
}
const nonce = crypto.randomUUID();
const files = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/__reading-audit-harness')
            return new Response('<!doctype html><title>Actual-content reading audit</title><style>html,body{margin:0;width:100%;height:100%}</style><main id="audit-host" style="position:fixed;inset:0"></main>', { headers: { 'Content-Type': 'text/html' } });
        const match = new RegExp(`^/${nonce}/(\\d+)$`).exec(url.pathname);
        const input = match ? inputs[Number(match[1])] : undefined;
        if (input)
            return new Response(Bun.file(input.file), { headers: { 'Cache-Control': 'no-store' } });
        if (request.method === 'GET' && /^\/(src\/lib\/|node_modules\/|@fs\/|@id\/|@vite\/)/.test(url.pathname))
            return fetch(new URL(url.pathname + url.search, origin), { signal: request.signal });
        return new Response(null, { status: 404 });
    } });
const admitted = await fetch(`http://127.0.0.1:${files.port}/${nonce}/0`);
assert.equal(admitted.status, 200);
await admitted.body?.cancel();
const browser = await chromium.launch();
const report = { boundary: 'Fixed actual-content replay; live acquisition, session preparation and transfer excluded. Warm alternating trials; round -1 is warm-up. Dev HMR is deliberately disconnected in this isolated host; its expected diagnostics are separate from engine errors. No hardware GPU, production p95 or process-memory claim.', startedAt: new Date().toISOString(), browser: browser.version(), baseline, rounds, sanitizeOddPages, samples: [] as unknown[], errors: [] as string[], harnessDiagnostics: [] as string[] };
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => {
        if (message.type() !== 'error')
            return;
        const text = message.text().replace(/http:\/\/127\.0\.0\.1:[^\s']+/g, 'private-input');
        const expectedHmr = text.startsWith('[vite] failed to connect to websocket.') || text.startsWith("Failed to send error to Vite server: TypeError: Cannot read properties of undefined (reading 'send')");
        (expectedHmr ? report.harnessDiagnostics : report.errors).push(text);
    });
    await page.routeWebSocket('**', socket => socket.close());
    await page.goto(`http://127.0.0.1:${files.port}/__reading-audit-harness`);
    const cdp = await page.context().newCDPSession(page);
    if (process.env.COAST_READING_AUDIT_KIND === 'padding') {
        const padding = await page.evaluate(verifyReadingPadding, { url: `http://127.0.0.1:${files.port}/${nonce}/0`, format: inputs[0].format, baseline });
        Object.assign(report, { padding });
        console.log(JSON.stringify(padding));
    }
    else if (process.env.COAST_READING_AUDIT_KIND === 'entry') {
        const result = await page.evaluate(compareReadingEntry, { url: `http://127.0.0.1:${files.port}/${nonce}/0`, format: inputs[0].format, baseline });
        Object.assign(report, { [process.env.COAST_READING_AUDIT_KIND!]: result });
        console.log(JSON.stringify(result));
    }
    else if (process.env.COAST_READING_AUDIT_KIND === 'turns') {
        const turns = await page.evaluate(verifyReadingTurns, { url: `http://127.0.0.1:${files.port}/${nonce}/0`, format: inputs[0].format });
        Object.assign(report, { turns });
        console.log(JSON.stringify(turns));
    }
    else if (process.env.COAST_READING_AUDIT_KIND === 'renderer') {
        const input = inputs[0];
        const renderer = await page.evaluate(verifyReadingRenderer, { url: `http://127.0.0.1:${files.port}/${nonce}/0`, format: input.format, sha256: input.sha256, baseline: baseline.replace(/physical-pages\.ts$/, 'physical/renderer.ts'), current: '/src/lib/reading/reader/physical/renderer.ts' });
        Object.assign(report, { renderer });
        console.log(JSON.stringify(renderer));
    }
    else
        for (const [inputIndex, input] of inputs.entries()) {
            const reference = await page.evaluate(async ({ url, format }) => {
                const { openComicArchive } = await import('/src/lib/reading/reader/comic-archive.ts');
                const owner = new AbortController();
                const archive = await openComicArchive(new File([await (await fetch(url)).blob()], 'actual-document'), format, owner.signal);
                try {
                    const bitmap = await createImageBitmap(await archive.read(archive.entries.at(-1)!.index, owner.signal));
                    try {
                        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
                        const full = document.createElement('canvas');
                        full.width = Math.round(bitmap.width * scale);
                        full.height = Math.round(bitmap.height * scale);
                        full.getContext('2d')!.drawImage(bitmap, 0, 0, full.width, full.height);
                        const right = document.createElement('canvas');
                        const middle = Math.floor(full.width / 2);
                        right.width = full.width - middle;
                        right.height = full.height;
                        right.getContext('2d')!.drawImage(full, middle, 0, right.width, right.height, 0, 0, right.width, right.height);
                        const pixels = [];
                        for (const canvas of [full, right]) {
                            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data))).map(byte => byte.toString(16).padStart(2, '0')).join('');
                            pixels.push({ width: canvas.width, height: canvas.height, hash });
                        }
                        return { total: archive.entries.length, outsideBack: pixels };
                    }
                    finally {
                        bitmap.close();
                    }
                }
                finally {
                    await archive.close();
                    owner.abort();
                }
            }, { url: `http://127.0.0.1:${files.port}/${nonce}/${inputIndex}`, format: input.format });
            const expected = new Map<string, string>();
            const variants = new Map<string, any>();
            for (let round = -1; round < rounds; round++) {
                for (const variant of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
                    await cdp.send('HeapProfiler.collectGarbage');
                    const result = await page.evaluate(async ({ module, input, fileUrl }) => {
                        const { physicalPages } = await import(/* @vite-ignore */ module);
                        const data = await (await fetch(fileUrl)).blob();
                        const abort = new AbortController();
                        let canvases = 0, draws = 0, decodes = 0, closed = 0;
                        const create = document.createElement.bind(document), bitmap = window.createImageBitmap.bind(window), draw = CanvasRenderingContext2D.prototype.drawImage;
                        document.createElement = ((name: string, ...args: unknown[]) => {
                            if (name === 'canvas')
                                canvases++;
                            return (create as Function)(name, ...args);
                        }) as typeof document.createElement;
                        CanvasRenderingContext2D.prototype.drawImage = function (...args: unknown[]) { draws++; return (draw as Function).apply(this, args); };
                        window.createImageBitmap = (async (...args: unknown[]) => {
                            decodes++;
                            const image: ImageBitmap = await (bitmap as Function)(...args), close = image.close.bind(image);
                            image.close = () => { closed++; close(); };
                            return image;
                        }) as typeof createImageBitmap;
                        let pages: Awaited<ReturnType<typeof physicalPages>> | undefined;
                        const timer = setTimeout(() => abort.abort(new DOMException('Audit operation deadline.', 'TimeoutError')), 60000);
                        try {
                            const start = performance.now();
                            pages = await physicalPages({ source: new File([data], 'actual-document'), format: input.format, kind: input.kind, sanitizeOddPages: input.sanitizeOddPages, signal: abort.signal });
                            const inspectionMs = performance.now() - start, inspection = { canvases, draws, decodes, closed };
                            const locations = Array.from({ length: pages.count }, (_, index) => pages!.location(index));
                            const pixels = [];
                            for (let index = 0; index < pages.count; index++) {
                                const canvas = await pages.page(index, abort.signal);
                                const raster = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
                                const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raster.data))).map(byte => byte.toString(16).padStart(2, '0')).join('');
                                pixels.push({ index, width: canvas.width, height: canvas.height, hash });
                            }
                            return { inspectionMs, inspection, locations, pixels, totalDecodes: decodes, totalDraws: draws };
                        }
                        finally {
                            clearTimeout(timer);
                            abort.abort();
                            await pages?.close();
                            document.createElement = create;
                            window.createImageBitmap = bitmap;
                            CanvasRenderingContext2D.prototype.drawImage = draw;
                        }
                    }, { module: variant === 'baseline' ? baseline : '/src/lib/reading/reader/physical-pages.ts', input: { format: input.format, kind: input.kind, sanitizeOddPages }, fileUrl: `http://127.0.0.1:${files.port}/${nonce}/${inputIndex}` });
                    const identity = JSON.stringify({ locations: result.locations, pixels: result.pixels });
                    if (!expected.has(variant))
                        expected.set(variant, identity);
                    assert.equal(identity, expected.get(variant), 'Every raster and location must remain stable within the same policy.');
                    variants.set(variant, result);
                    if (variants.size === 2) {
                        const before = variants.get('baseline'), after = variants.get('current');
                        if (sanitizeOddPages) {
                            assert.deepEqual(after.locations, before.locations, 'Default sanitization retains original saved-location behavior');
                            assert.deepEqual(after.pixels, before.pixels, 'Default sanitization retains every original displayed pixel');
                        }
                        else {
                            const raster = ({ width, height, hash }: any) => JSON.stringify({ width, height, hash });
                            const printed = after.pixels.filter((_: unknown, index: number) => after.locations[index]);
                            let next = 0;
                            for (const old of before.pixels) {
                                while (next < printed.length && raster(printed[next]) !== raster(old))
                                    next++;
                                assert(next < printed.length, 'Every previous printed face must remain, in order and pixel-exact.');
                                next++;
                            }
                            assert(printed.length >= before.pixels.length && printed.length <= before.pixels.length + 1, 'Only the formerly trimmed face may be restored.');
                            assert.deepEqual(printed.slice(0, before.pixels.length).map(raster), before.pixels.map(raster), 'The sole additional printed face must be the actual trailing image.');
                            assert.equal(after.pixels.length, Math.max(4, printed.length + printed.length % 2));
                            assert.equal(raster(after.pixels[0]), raster(before.pixels[0]), 'Front cover must remain unchanged.');
                            assert(reference.outsideBack.some(face => raster(face) === raster(after.pixels.at(-1))), 'Outside back cover must be the actual final scan or its right half.');
                            const locations = after.locations.filter(Boolean);
                            assert.deepEqual([...new Set(locations.map((location: any) => location.page))], Array.from({ length: reference.total }, (_, index) => index + 1), 'Every original scan must retain a truthful location.');
                            for (const location of locations) {
                                assert.equal(location.total, reference.total);
                                assert.equal(location.format, input.format);
                            }
                        }
                    }
                    report.samples.push({ inputSha256: input.sha256, bytes: input.bytes, format: input.format, round, variant, ...result });
                    await Bun.write(output, JSON.stringify(report, null, 2));
                    console.log(JSON.stringify({ input: input.sha256.slice(0, 12), round, variant, ms: result.inspectionMs, inspection: result.inspection, faces: result.locations.length }));
                }
            }
        }
    assert.deepEqual(report.errors, []);
}
finally {
    await browser.close();
    files.stop(true);
    await Bun.write(resolve(output), JSON.stringify(report, null, 2));
}
