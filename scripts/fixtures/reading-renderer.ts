// Browser-side actual-raster probe, executed only by the opt-in reading audit.
// Failure injection is controlled; assets and Three.js are real. Staging retains
// at most twelve actual faces and is outside the production memory measurement.
export async function verifyReadingRenderer(input: {
    url: string;
    format: string;
    sha256: string;
    baseline: string;
    current: string;
}) {
    const { physicalPages } = await import('/src/lib/reading/reader/physical-pages.ts');
    const controller = new AbortController(), blob = await (await fetch(input.url)).blob();
    const pages = await physicalPages({ source: new File([blob], 'actual.cbr'), format: input.format, sanitizeOddPages: false, signal: controller.signal });
    const assets = new Map();
    const wanted = new Set([0, 1, pages.count - 2, pages.count - 1, ...Array.from({ length: 8 }, (_, i) => i)].filter(i => i >= 0 && i < pages.count));
    for (const i of wanted)
        assets.set(i, await pages.page(i, controller.signal));
    await pages.close();
    const host = document.getElementById('audit-host')!, contexts: any[] = [], get = HTMLCanvasElement.prototype.getContext;
    const draws = { count: 0 };
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { const value = get.call(this, type, ...args as any); if (type === 'webgl2' && value && !contexts.includes(value)) {
        contexts.push(value);
        for (const method of ['drawElements', 'drawArrays']) {
            const original = value[method].bind(value);
            value[method] = (...a) => { draws.count++; return original(...a); };
        }
    } return value; } as any;
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms)), results = [], faults = [];
    const NativeObserver = window.ResizeObserver, observers = [];
    window.ResizeObserver = class extends NativeObserver {
        active = false;
        constructor(callback) { super(callback); observers.push(this); }
        observe(...args) { this.active = true; return super.observe(...args); }
        disconnect() { this.active = false; return super.disconnect(); }
    };
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener, listeners = [];
    EventTarget.prototype.addEventListener = function (type, handler, options) { if (this === host || this === document)
        listeners.push({ target: this, type, handler, options, removed: false }); return add.call(this, type, handler, options); };
    EventTarget.prototype.removeEventListener = function (type, handler, options) { for (const entry of listeners)
        if (entry.target === this && entry.type === type && entry.handler === handler)
            entry.removed = true; return remove.call(this, type, handler, options); };
    const activeListeners = () => listeners.filter(entry => !entry.removed && !entry.options?.signal?.aborted).length;
    let gpu = '';
    try {
        for (const version of ['baseline', 'current']) {
            const { createRenderer } = await import(version === 'baseline' ? input.baseline : input.current);
            for (const fault of ['append', 'state']) {
                const append = host.append;
                if (fault === 'append')
                    host.append = () => { throw Error('Controlled append failure'); };
                let rejected = false;
                try {
                    await createRenderer(host, { count: pages.count, getPage: async (i) => assets.get(i), modelKind: 'comic', onState: () => { if (fault === 'state')
                            throw Error('Controlled state failure'); } });
                }
                catch (cause) {
                    rejected = String(cause).includes('Controlled');
                }
                finally {
                    host.append = append;
                }
                const gl = contexts.at(-1);
                if (!gpu)
                    gpu = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
                const row = { version, fault, rejected, liveContexts: contexts.filter(c => !c.isContextLost()).length, canvases: host.querySelectorAll('canvas').length, observers: observers.filter(o => o.active).length, listeners: activeListeners() };
                faults.push(row);
                if (version === 'current' && (!rejected || row.liveContexts || row.canvases || row.observers || row.listeners))
                    throw Error('Failed construction leaked ' + JSON.stringify(row));
                for (const o of observers)
                    o.disconnect();
                for (const entry of listeners) {
                    remove.call(entry.target, entry.type, entry.handler, entry.options);
                    entry.removed = true;
                }
                for (const c of contexts)
                    c.getExtension('WEBGL_lose_context')?.loseContext();
                host.replaceChildren();
                await delay(25);
            }
            for (let cycle = 0; cycle < 3; cycle++) {
                const start = performance.now(), renderer = await createRenderer(host, { count: pages.count, getPage: async (i) => assets.get(i), modelKind: cycle === 2 ? 'book' : 'comic' });
                const initMs = performance.now() - start;
                await delay(100);
                const beforeIdle = draws.count;
                await delay(250);
                const idleDraws = draws.count - beforeIdle;
                const gl = contexts.at(-1), canvas = host.querySelector('canvas');
                const beforeClose = performance.now();
                renderer.dispose();
                const disposeMs = performance.now() - beforeClose;
                await delay(25);
                if (version === 'current')
                    renderer.dispose();
                results.push({ version, cycle, observers: observers.filter(o => o.active).length, listeners: activeListeners(), kind: cycle === 2 ? 'book' : 'comic', initMs, idleDraws, disposeMs, contextLost: gl.isContextLost(), canvasCount: host.querySelectorAll('canvas').length, createdContexts: contexts.length, liveContexts: contexts.filter(c => !c.isContextLost()).length });
                if (version === 'baseline')
                    gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
        }
        for (const row of results.filter(r => r.version === 'current'))
            if (row.idleDraws || row.liveContexts || row.canvasCount || row.observers || row.listeners)
                throw Error('Unreleased renderer owner ' + JSON.stringify(row));
        return { results, faults, inputSha256: input.sha256, faces: pages.count, gpu };
    }
    finally {
        controller.abort();
        HTMLCanvasElement.prototype.getContext = get;
        window.ResizeObserver = NativeObserver;
        EventTarget.prototype.addEventListener = add;
        EventTarget.prototype.removeEventListener = remove;
        assets.clear();
        host.replaceChildren();
    }
}
/** Actual document, current engine and real animations; no server bookmark writes. */
export async function verifyReadingTurns(input: {
    url: string;
    format: string;
}) {
    const { physicalPages } = await import('/src/lib/reading/reader/physical-pages.ts');
    const { physicalReader } = await import('/src/lib/reading/reader/physical-reader.ts');
    const blob = await (await fetch(input.url)).blob(), file = new File([blob], 'actual-document');
    const inspection = new AbortController(), pages = await physicalPages({ source: file, format: input.format, sanitizeOddPages: false, signal: inspection.signal });
    const total = pages.location(0).total;
    await pages.close();
    inspection.abort();
    const saved = { format: input.format, page: Math.min(8, total), total }, results = [];
    const host = document.getElementById('audit-host');
    for (const scenario of [{ kind: 'comic', following: false }, { kind: 'book', following: false }, { kind: 'comic', following: true }]) {
        const owner = new AbortController(), changes = [], errors = [];
        let engine;
        const start = performance.now();
        try {
            engine = await physicalReader({ host, source: file, format: input.format, kind: scenario.kind, location: saved, signal: owner.signal, controlled: () => !scenario.following, changed: location => changes.push(location), failed: error => errors.push(String(error)) });
            const entranceMs = performance.now() - start;
            if (changes.length)
                throw Error('Entrance overwrote the bookmark');
            const open = performance.now();
            await engine.next();
            const openMs = performance.now() - open;
            const turn = performance.now();
            await engine.next();
            const turnMs = performance.now() - turn;
            if (scenario.following) {
                if (changes.length)
                    throw Error('Follower changed the room location');
            }
            else {
                if (!changes.length || changes.at(-1).page <= saved.page)
                    throw Error('Actual forward turn failed');
                await engine.previous();
                if (changes.at(-1).page !== saved.page)
                    throw Error('Actual backward turn failed');
            }
            const count = changes.length;
            await engine.go({ ...saved, page: Math.min(total - 2, 14) });
            if (changes.length !== count)
                throw Error('External navigation echoed a bookmark change');
            if (errors.length)
                throw Error(errors.join('\n'));
            results.push({ ...scenario, entranceMs, openMs, turnMs, changes, externalNavigationSilent: true });
        }
        finally {
            engine?.destroy();
            owner.abort();
            if (host.querySelector('canvas'))
                throw Error('Actual turn test retained its canvas');
        }
    }
    return { results, total, boundary: 'Actual CBR content; hardback is a presentation check over those same rasters, not native book/PDF/EPUB acceptance. Follower controls are local controlled state, not a live two-account party.' };
}
export async function compareReadingEntry(input: {
    url: string;
    format: string;
    baseline: string;
}) {
    const blob = await (await fetch(input.url)).blob(), file = new File([blob], 'actual-document');
    const host = document.getElementById('audit-host'), results = [];
    for (let round = -1; round < 4; round++)
        for (const version of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
            const module = version === 'baseline' ? input.baseline.replace(/physical-pages\.ts$/, 'physical-reader.ts') : '/src/lib/reading/reader/physical-reader.ts';
            const { physicalReader } = await import(module), abort = new AbortController(), changes = [], errors = [];
            let engine;
            const start = performance.now();
            try {
                engine = await physicalReader({ host, source: file, format: input.format, kind: 'comic', location: { format: input.format, page: 8, total: 24 }, signal: abort.signal, changed: location => changes.push(location), failed: error => errors.push(String(error)) });
                const ms = performance.now() - start;
                if (changes.length || errors.length)
                    throw Error('Entry changed a bookmark or failed');
                results.push({ round, version, ms });
            }
            finally {
                const canvas = host.querySelector('canvas'), context = canvas?.getContext('webgl2');
                engine?.destroy();
                abort.abort();
                context?.getExtension('WEBGL_lose_context')?.loseContext();
                if (host.querySelector('canvas'))
                    throw Error('Entry retained canvas');
            }
        }
    return { results, boundary: 'Actual file replay: archive open, inspection, required raster/texture work, GPU construction and the unchanged entrance animation. Excludes provider preparation/download; software GPU. Baseline context is explicitly lost after its normal destroy, outside the entry timer.' };
}
/** Controlled odd-page container, containing untouched images from a real file. */
export async function verifyReadingPadding(input: {
    url: string;
    format: string;
    baseline: string;
}) {
    const { openComicArchive } = await import('/src/lib/reading/reader/comic-archive.ts');
    const { ZipWriter, BlobWriter, BlobReader } = await import('/node_modules/@zip.js/zip.js/index.js');
    const blob = await (await fetch(input.url)).blob(), original = new File([blob], 'actual-document'), owner = new AbortController();
    const archive = await openComicArchive(original, input.format, owner.signal);
    const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
    try {
        for (let index = 0; index < 3; index++)
            await writer.add(`${index}.jpg`, new BlobReader(await archive.read(archive.entries[index].index, owner.signal)));
    }
    finally {
        await archive.close();
    }
    const file = new File([await writer.close()], 'actual-images-odd.cbz'), results = [];
    const hash = async (canvas) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const { physicalPages } = await import('/src/lib/reading/reader/physical-pages.ts');
    const reference = await physicalPages({ source: original, format: input.format, sanitizeOddPages: false, signal: owner.signal });
    const thirdImageHash = await hash(await reference.page(2, owner.signal));
    await reference.close();
    for (const version of ['baseline', 'current']) {
        const module = await import(version === 'baseline' ? input.baseline : '/src/lib/reading/reader/physical-pages.ts');
        const pages = await module.physicalPages({ source: file, format: 'cbz', sanitizeOddPages: false, signal: owner.signal });
        try {
            const locations = Array.from({ length: pages.count }, (_, index) => pages.location(index));
            const pixels = [];
            for (let index = 0; index < pages.count; index++)
                pixels.push(await hash(await pages.page(index, owner.signal)));
            if (version === 'current' && (pages.count !== 4 || pixels[3] !== thirdImageHash || locations[3]?.page !== 3 || locations[2] !== undefined))
                throw Error('Actual final image or canonical location was lost');
            results.push({ version, count: pages.count, locations, pixelHashes: pixels });
        }
        finally {
            await pages.close();
        }
    }
    owner.abort();
    return { results, thirdImageHash, boundary: 'Three untouched actual comic images repackaged into a controlled odd-count ZIP. No fake image, catalogue, user or provider response. This establishes actual-content tail preservation, not natural small-CBZ library acceptance.' };
}
