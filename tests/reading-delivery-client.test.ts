import { expect, test } from 'bun:test';
import { remoteComic } from '../src/lib/reading/reader/remote-comic';
const document = { version: 1, format: 'cbz', edition: 'a'.repeat(64), pages: [{ width: 10, height: 20, bytes: 3 }] };
async function withFetch(run: (requests: AbortSignal[]) => Promise<void>, page: (signal: AbortSignal) => Promise<Response>) {
    const original = globalThis.fetch, requests: AbortSignal[] = [];
    globalThis.fetch = (async (input: string, options: RequestInit) => {
        if (input.endsWith('/manifest'))
            return new Response(JSON.stringify({ manifest: document }) + '\n');
        const signal = options.signal!;
        requests.push(signal);
        return page(signal);
    }) as typeof fetch;
    try {
        await run(requests);
    }
    finally {
        globalThis.fetch = original;
    }
}
test('simultaneous halves share one page download and cancellation preserves the remaining caller', async () => {
    let finish: (response: Response) => void = () => { };
    await withFetch(async (requests) => {
        const session = new AbortController(), first = new AbortController(), second = new AbortController();
        const comic = await remoteComic('/sessions/reader/manifest', session.signal);
        const left = comic.read(0, first.signal), right = comic.read(0, second.signal);
        first.abort();
        await expect(left).rejects.toThrow();
        expect(requests.length).toBe(1);
        expect(requests[0].aborted).toBe(false);
        finish(new Response(new Uint8Array([1, 2, 3])));
        expect(await (await right).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    }, () => new Promise(resolve => { finish = resolve; }));
});
test('last caller cancellation aborts the underlying page request', async () => {
    await withFetch(async (requests) => {
        const session = new AbortController(), owner = new AbortController();
        const comic = await remoteComic('/sessions/reader/manifest', session.signal);
        const page = comic.read(0, owner.signal);
        owner.abort();
        await expect(page).rejects.toThrow();
        expect(requests[0].aborted).toBe(true);
    }, signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
});
test('page transfer rejects oversized and truncated bytes before creating a blob', async () => {
    for (const count of [2, 4])
        await withFetch(async () => {
            const signal = new AbortController().signal, comic = await remoteComic('/sessions/reader/manifest', signal);
            await expect(comic.read(0, signal)).rejects.toThrow(count < 3 ? 'incomplete' : 'verified size');
        }, async () => new Response(new Uint8Array(count)));
});
test('manifest schema rejects private fields and invalid page dimensions', async () => {
    const original = globalThis.fetch;
    try {
        for (const invalid of [{ ...document, secret: 'private' }, { ...document, pages: [{ width: 9999, height: 20, bytes: 3 }] }]) {
            globalThis.fetch = (async () => new Response(JSON.stringify({ manifest: invalid }) + '\n')) as unknown as typeof fetch;
            await expect(remoteComic('/sessions/reader/manifest', new AbortController().signal)).rejects.toThrow();
        }
    }
    finally {
        globalThis.fetch = original;
    }
});
