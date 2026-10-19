import { readingCache, readingLease } from './cache.server';
import { readingDeliverySource } from './sessions.server';
import { AppError } from '$lib/server/security/errors';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
/** One operation streams progress, then its version-bound layout. No progress jobs or polling. */
export async function readingManifest(userId: string, id: string, request: Request) {
    const source = await readingDeliverySource(userId, id, request.signal);
    const cache = await readingCache(), lease = readingLease(userId, id), entry = await cache.acquire(lease, source);
    const releaseOperation = cache.claim(lease, entry);
    const cancellation = new AbortController(), signal = AbortSignal.any([request.signal, cancellation.signal]);
    const encoder = new TextEncoder();
    let delivered = false;
    async function* events() {
        try {
            for (;;) {
                signal.throwIfAborted();
                entry.controller.signal.throwIfAborted();
                if (entry.error)
                    throw entry.error instanceof AppError ? entry.error : new AppError(422, 'This reading archive could not be prepared.');
                cache.touch(lease);
                if (entry.manifest && entry.finished) {
                    // A long acquisition cannot publish after its reader/version was withdrawn.
                    await readingDeliverySource(userId, id, signal);
                    delivered = true;
                    yield { manifest: entry.manifest };
                    return;
                }
                const changed = entry.changed;
                yield { progress: entry.progress };
                await cache.wait(entry, changed, signal);
            }
        }
        catch (cause) {
            if (!signal.aborted)
                yield { error: cause instanceof AppError ? cause.message : 'This reading archive could not be prepared.' };
        }
        finally {
            if (!delivered)
                releaseOperation();
        }
    }
    const iterator = events();
    return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await iterator.next();
                if (next.done)
                    controller.close();
                else
                    controller.enqueue(encoder.encode(JSON.stringify(next.value) + '\n'));
            }
            catch (cause) {
                controller.error(cause);
            }
        },
        async cancel() {
            cancellation.abort();
            await iterator.return();
        },
    }), { headers: { ...headers, 'Content-Type': 'application/x-ndjson' } });
}
export async function readingPage(userId: string, id: string, index: string, request: Request) {
    if (!/^(0|[1-9]\d{0,3})$/.test(index))
        throw new AppError(404, 'Reading page not found.');
    const source = await readingDeliverySource(userId, id, request.signal);
    const cache = await readingCache();
    const lease = readingLease(userId, id), entry = await cache.acquire(lease, source);
    cache.claim(lease, entry);
    const signal = AbortSignal.any([request.signal, entry.controller.signal]);
    while (!entry.manifest && !entry.finished)
        await cache.wait(entry, entry.changed, signal);
    const page = await cache.page(entry, Number(index), signal);
    // Admission and page lookup yield even on warm hits. Reauthorize after both
    // before publishing, so a close/reconnect cannot recreate an ended lease.
    await readingDeliverySource(userId, id, signal);
    // The response can outlive preparation. Request cancellation or cache eviction aborts its file reader.
    const body = Bun.file(page.path).stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
            signal.throwIfAborted();
            controller.enqueue(chunk);
        } }), { signal });
    return new Response(body, { headers: { ...headers, 'Content-Type': page.mime, 'Content-Length': String(page.bytes) } });
}
