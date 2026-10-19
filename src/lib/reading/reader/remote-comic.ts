import * as v from 'valibot';
import { readingManifestSchema, type ReadingManifest } from '../delivery';
import type { ReaderProgress } from './load';
import { readerLoad } from './load';
/** One cancellable progress stream and one verified manifest; no poller or archive in the browser. */
export async function remoteComic(manifestUrl: string, signal: AbortSignal, progress?: (value: ReaderProgress) => void) {
    signal.throwIfAborted();
    const response = await fetch(manifestUrl, { signal });
    if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error ?? 'This reading edition could not be prepared.');
    }
    if (!response.body)
        throw new Error('The reading manifest is unavailable.');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '', manifest: ReadingManifest | undefined;
    try {
        for (;;) {
            const part = await reader.read();
            signal.throwIfAborted();
            pending += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
            if (pending.length > 2 * 1024 ** 2)
                throw new Error('The reading manifest exceeds its size limit.');
            let newline: number;
            while ((newline = pending.indexOf('\n')) >= 0) {
                const event = JSON.parse(pending.slice(0, newline));
                pending = pending.slice(newline + 1);
                if (event.error)
                    throw new Error(event.error);
                if (event.progress && ['download', 'prepare', 'inspect'].includes(event.progress.phase))
                    progress?.(event.progress);
                if (event.manifest)
                    manifest = v.parse(readingManifestSchema, event.manifest);
            }
            if (part.done)
                break;
        }
        if (pending.trim() || !manifest)
            throw new Error('The reading manifest is incomplete.');
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
    const document = manifest;
    const inflight = new Map<number, {
        controller: AbortController;
        users: number;
        settled: boolean;
        promise: Promise<Blob>;
    }>();
    async function readPage(index: number, owner: AbortSignal) {
        const entry = document.pages[index];
        const result = await fetch(`${manifestUrl.replace(/\/manifest$/, '')}/pages/${index}`, { signal: owner });
        if (!result.ok) {
            const failure = await result.json().catch(() => null);
            throw new Error(failure?.error ?? 'This reading page is unavailable.');
        }
        if (!result.body)
            throw new Error('This reading page is unavailable.');
        const reader = result.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
        let bytes = 0;
        try {
            for (;;) {
                owner.throwIfAborted();
                const part = await readerLoad(reader.read(), owner);
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                if (bytes > entry.bytes)
                    throw new Error('This reading page exceeds its verified size.');
                chunks.push(part.value as Uint8Array<ArrayBuffer>);
            }
            if (bytes !== entry.bytes)
                throw new Error('This reading page is incomplete.');
            return new Blob(chunks, { type: result.headers.get('content-type') ?? 'application/octet-stream' });
        }
        finally {
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
    }
    return {
        manifest: document,
        async read(index: number, owner: AbortSignal) {
            owner.throwIfAborted();
            const entry = document.pages[index];
            if (!entry)
                throw new RangeError('Comic page index is out of range.');
            let operation = inflight.get(index);
            if (!operation) {
                const controller = new AbortController();
                operation = { controller, users: 0, settled: false, promise: Promise.resolve(null as unknown as Blob) };
                const current = operation;
                current.promise = readPage(index, AbortSignal.any([signal, controller.signal])).finally(() => {
                    current.settled = true;
                    if (inflight.get(index) === current)
                        inflight.delete(index);
                });
                // Coalesce simultaneous halves of one scan; retain no encoded page cache.
                if (inflight.size < 8)
                    inflight.set(index, current);
            }
            operation.users++;
            try {
                return await readerLoad(operation.promise, owner);
            }
            finally {
                if (!--operation.users && !operation.settled) {
                    if (inflight.get(index) === operation)
                        inflight.delete(index);
                    operation.controller.abort();
                }
            }
        },
    };
}
