import { chromium } from '@playwright/test';
import { getSql, closeDb } from '#lib/server/db/index.js';
import { newSession, logout } from '#lib/server/auth/index.js';
import assert from 'node:assert/strict';
// Opt-in normal-dev acceptance with actual media/admin access; no bookmark callbacks.
const origin = process.env.COAST_READING_UI_ORIGIN ?? 'http://localhost:5173';
const manifest = process.env.COAST_READING_ACTUAL_MANIFEST, output = process.env.COAST_READING_AUDIT_OUTPUT;
assert(manifest && output, 'Supply private actual manifest and output paths.');
const sql = getSql(), [input] = await Bun.file(manifest).json();
let browser: any, auth: any, context: any;
const sessions = new Set<string>();
const report: any = { boundary: 'Actual admin, canonical comic and original live pages. Controlled interior gate proves scheduling, not latency; no bookmark/history writes. Browser plugin not available; existing Playwright fallback.', cases: [], errors: [] };
try {
    const [admin] = await sql `select id,username,role,email,settings from users where username='admin' and role='admin' and not disabled`;
    auth = await newSession(admin);
    browser = await chromium.launch();
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addCookies([{ name: 'coast_session', value: auth.token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.on('response', async (response: any) => {
        if (response.ok() && response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/reading/${input.id}/session`)
            sessions.add((await response.json()).id);
    });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.route(origin + '/__reading-stage', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Actual staged reading</title><div id="host" style="position:fixed;inset:0;background:#242424"></div>' }));
    for (const variant of ['staged']) {
        await page.goto(origin + '/__reading-stage');
        const first = await page.evaluate(async ({ id, variant }) => {
            const w = window as any, owner = new AbortController(), host = document.getElementById('host')!, calls: number[] = [], failures: string[] = [];
            let session: any, renderer: any, unblock!: () => void, ready = false;
            const gate = new Promise<void>(r => unblock = r);
            const response = await fetch(`/api/v1/reading/${id}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'linked' }) });
            session = await response.json();
            const { physicalPages } = await import('/src/lib/reading/reader/physical-pages.ts');
            const pages = await physicalPages({ host, source: session.url, manifest: session.manifest, format: session.format, signal: owner.signal, location: null, changed: () => { } });
            const { createRenderer } = await import('/src/lib/reading/reader/physical/renderer.ts');
            let coverDone = 0;
            let coversReady!: () => void;
            const covers = new Promise<void>(r => coversReady = r);
            const pending = createRenderer(host, { count: pages.count, entrance: true, getPage: async (index: number) => {
                    calls.push(index);
                    if (index !== 0 && index !== pages.count - 1)
                        await gate;
                    const canvas = await pages.page(index, owner.signal);
                    if (index === 0 || index === pages.count - 1) {
                        coverDone++;
                        if (coverDone === 2)
                            coversReady();
                    }
                    return canvas;
                }, onError: (e: any) => failures.push(String(e)) }).then((value: any) => {
                ready = true;
                renderer = value;
                return value;
            });
            await covers;
            await pending;
            const factory = { ready, calls: [...calls], canvases: host.querySelectorAll('canvas').length };
            const entering = renderer.enter(2);
            w.__stage = { calls, finish: async () => {
                    unblock();
                    renderer = await pending;
                    await entering;
                    await renderer.open();
                    await renderer.showPage(pages.count);
                    await renderer.open();
                    await renderer.leave();
                    const result = { factory, calls: [...calls], failures };
                    owner.abort();
                    renderer.dispose();
                    await pages.close();
                    await fetch(`/api/v1/reading/sessions/${session.id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    return result;
                } };
            return factory;
        }, { id: input.id, variant });
        assert(first.ready);
        assert.equal(first.calls.length, 2);
        assert.equal(first.canvases, 1);
        await page.waitForTimeout(600);
        const pendingCalls = await page.evaluate(() => (window as any).__stage.calls.slice(2));
        assert(pendingCalls.length > 0 && pendingCalls.every((index: number) => index === 1 || index === 2), 'Only the opening spread may load before the interior gate resolves.');
        if (process.env.COAST_READING_SCREENSHOT)
            await page.screenshot({ path: process.env.COAST_READING_SCREENSHOT });
        const result = await page.evaluate(() => (window as any).__stage.finish());
        assert.deepEqual(result.failures, []);
        report.cases.push({ variant, ...result });
        console.log(JSON.stringify({ variant, factory: first }));
    }
    for (const mode of ['following', 'reduced', 'cancel']) {
        await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
        if (mode === 'reduced')
            await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(origin + '/__reading-stage');
        const result = await page.evaluate(async ({ id, mode }) => {
            const owner = new AbortController(), host = document.getElementById('host')!, changed: unknown[] = [], calls: number[] = [], progress: string[] = [];
            let engine: any, session: any, failure: any;
            const original = window.fetch.bind(window);
            try {
                const prepared = await fetch(`/api/v1/reading/${id}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'linked' }) });
                if (!prepared.ok)
                    throw new Error('Actual session preparation failed.');
                session = await prepared.json();
                const layout = await fetch(session.manifest);
                const events = (await layout.text()).trim().split('\n').map(line => JSON.parse(line));
                const document = events.at(-1).manifest;
                if (!document)
                    throw new Error('Actual manifest unavailable.');
                window.fetch = (async (input: any, options: any) => {
                    const match = String(input).match(/\/pages\/(\d+)$/);
                    if (match) {
                        const index = Number(match[1]);
                        calls.push(index);
                        if (calls.length <= 2 && progress.at(-1) === 'render')
                            throw new Error('Loading feedback ended before the outside covers were ready.');
                        if (mode === 'cancel' && index === 1)
                            owner.abort(new DOMException('Controlled entry cancellation.', 'AbortError'));
                    }
                    return original(input, options);
                }) as typeof fetch;
                const path = '/src/lib/reading/reader/engine.ts';
                const { createReader } = await import(/* @vite-ignore */ path);
                try {
                    engine = await createReader({ host, source: session.url, manifest: session.manifest, format: session.format, kind: session.kind, signal: owner.signal,
                        location: mode === 'following' ? { format: session.format, page: Math.min(10, document.pages.length), total: document.pages.length } : null,
                        progress: (value: {
                            phase: string;
                        }) => progress.push(value.phase), controlled: mode === 'following' ? () => false : undefined, changed: (location: unknown) => changed.push(location) });
                }
                catch (cause) {
                    failure = cause;
                }
                if (mode === 'cancel') {
                    if (!owner.signal.aborted || failure?.name !== 'AbortError')
                        throw new Error('Entry cancellation did not settle with its abort reason.');
                }
                else {
                    if (failure)
                        throw failure;
                    if (!host.querySelector('canvas'))
                        throw new Error('Reader did not render.');
                    if (mode === 'following' && !calls.includes(Math.min(10, document.pages.length) - 1))
                        throw new Error('Following reader did not request its saved canonical page.');
                    if (!progress.includes('render'))
                        throw new Error('Ready reader did not retire loading feedback.');
                    await engine.leave();
                }
                engine?.destroy();
                return { mode, calls, progress, callbacks: changed.length, remainingCanvases: host.querySelectorAll('canvas').length };
            }
            finally {
                window.fetch = original;
                owner.abort();
                engine?.destroy();
                if (session)
                    await original(`/api/v1/reading/sessions/${session.id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            }
        }, { id: input.id, mode });
        assert.equal(result.callbacks, 0);
        assert.equal(result.remainingCanvases, 0);
        report.cases.push(result);
    }
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
}
catch (cause) {
    report.status = 'failed';
    report.failure = String(cause);
    throw cause;
}
finally {
    if (context)
        for (const id of sessions)
            await context.request.post(origin + `/api/v1/reading/sessions/${id}/close`, { headers: { Origin: origin }, data: {} }).catch(() => { });
    await browser?.close();
    if (auth)
        await logout(auth.token);
    await closeDb();
    await Bun.write(output!, JSON.stringify(report, null, 2));
}
