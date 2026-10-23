import { AsyncLocalStorage } from 'node:async_hooks';
import type { SQL } from 'bun';
type Query = {
    cancel(): unknown;
};
type Read = {
    signal: AbortSignal;
    queries: Set<Query>;
};
const reads = new AsyncLocalStorage<Read>();
/** Only explicitly read-only owners opt in. Mutations keep their acknowledgement contract. */
export async function withReadCancellation<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    if (!signal)
        return run();
    signal.throwIfAborted();
    if (reads.getStore()?.signal === signal)
        return run();
    const read: Read = { signal, queries: new Set() };
    const abort = () => { for (const query of read.queries)
        query.cancel(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        return await reads.run(read, async () => {
            signal.throwIfAborted();
            const result = await run();
            signal.throwIfAborted();
            return result;
        });
    }
    catch (error) {
        signal.throwIfAborted();
        throw error;
    }
    finally {
        signal.removeEventListener('abort', abort);
        read.queries.clear();
    }
}
/** Keep native lazy queries and values()/JSON handling intact. Cancellation is
 * tied to each query handle, never a pooled backend PID. Transaction callbacks
 * receive the same wrapper so Collection's reserved connection is covered. */
export function cancellableReads<T extends SQL>(client: T): T {
    return new Proxy(client, {
        get(target, property) {
            if (property === 'unsafe')
                return (...args: Parameters<SQL['unsafe']>) => {
                    const read = reads.getStore();
                    read?.signal.throwIfAborted();
                    const query = target.unsafe(...args);
                    read?.queries.add(query);
                    return query;
                };
            const value = Reflect.get(target, property, target);
            if (property === 'begin' && typeof value === 'function')
                return (...args: unknown[]) => Reflect.apply(value, target, args.map(arg => typeof arg === 'function' ? (tx: SQL) => arg(cancellableReads(tx)) : arg));
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
