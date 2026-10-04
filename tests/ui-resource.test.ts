import { describe, expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
import { lazyContent } from '../src/lib/ui/lazy-content';

// Exercise the real rune state with Svelte's existing compiler, without a DOM shim.
const source = await Bun.file(new URL('../src/lib/ui/resource.svelte.ts', import.meta.url)).text();
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
const compiled = compileModule(javascript, { filename: 'resource.svelte.js', generate: 'client' }).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'));
const { createResource, uniqueItems }: typeof import('../src/lib/ui/resource.svelte') =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('shared component resources', () => {
  test('superseded requests cannot publish data, errors or clear a newer loading state', async () => {
    const resource = createResource('initial', true);
    const old = deferred<string>(), latest = deferred<string>();
    let signal!: AbortSignal;
    const first = resource.load(current => { signal = current; return old.promise; });
    const second = resource.load(() => latest.promise);
    expect(signal.aborted).toBe(true);
    old.reject(new Error('stale failure'));
    await first;
    expect(resource.data).toBe('initial');
    expect(resource.error).toBe('');
    expect(resource.busy).toBe(true);
    latest.resolve('latest');
    await second;
    expect(resource.data).toBe('latest');
    expect(resource.busy).toBe(false);
  });

  test('replacement or component disposal cancels delivery even when fetch ignores abort', async () => {
    const resource = createResource('initial');
    const late = deferred<string>();
    const request = resource.load(() => late.promise);
    resource.replace('server data');
    late.resolve('stale response');
    await request;
    expect(resource.data).toBe('server data');
    expect(resource.ready).toBe(true);
    const disposed = deferred<string>();
    const after = resource.load(() => disposed.promise);
    resource.cancel();
    disposed.resolve('after unmount');
    await after;
    expect(resource.data).toBe('server data');
    expect(resource.busy).toBe(false);
  });

  test('a failed source retains settled content; a partial response publishes its usable items', async () => {
    type Content = { items: string[]; failure?: string };
    const resource = createResource<Content>({ items: ['old'] }, true);
    const options = {
      failure: (result: Content) => result.failure ?? '',
      usable: (result: Content) => !result.failure || result.items.length > 0,
    };
    await resource.load(async () => ({ items: [], failure: 'Provider unavailable' }), options);
    expect(resource.data.items).toEqual(['old']);
    expect(resource.error).toBe('Provider unavailable');
    await resource.load(async () => ({ items: ['available'], failure: 'One source unavailable' }), options);
    expect(resource.data.items).toEqual(['available']);
    expect(resource.error).toBe('One source unavailable');
    await resource.load(async () => ({ items: [] }), options);
    expect(resource.data.items).toEqual([]);
    expect(resource.error).toBe('');
  });

  test('append identity preserves repeated list occurrences and history events for the same work', () => {
    const entries = [{ id: 'work', entryId: 'one' }, { id: 'work', entryId: 'two' }];
    expect(uniqueItems([...entries, entries[0]], item => item.entryId)).toEqual(entries);
    const events = [{ id: 'work', eventId: 'first' }, { id: 'work', eventId: 'rewatch' }];
    expect(uniqueItems([...events, events[1]], item => item.eventId)).toEqual(events);
  });

  test('lazy shelves activate only once, sentinels repeat, and both clean up their observers', () => {
    const original = globalThis.IntersectionObserver;
    const callbacks: IntersectionObserverCallback[] = [];
    const margins: (string | undefined)[] = [];
    let disconnected = 0;
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { callbacks.push(callback); margins.push(options?.rootMargin); }
      observe() {}
      disconnect() { disconnected++; }
    } as unknown as typeof IntersectionObserver;
    try {
      let loads = 0, enabled = false;
      const shelf = lazyContent({} as HTMLElement, { load: () => loads++, enabled: () => enabled });
      const intersect = [{ isIntersecting: true }] as IntersectionObserverEntry[];
      callbacks[0](intersect, {} as IntersectionObserver);
      expect(loads).toBe(0);
      enabled = true;
      callbacks[0](intersect, {} as IntersectionObserver);
      callbacks[0](intersect, {} as IntersectionObserver);
      expect(loads).toBe(1);
      const sentinel = lazyContent({} as HTMLElement, { load: () => loads++, repeat: true, rootMargin: '0px' });
      expect(margins).toEqual(['300px','0px']);
      callbacks[1](intersect, {} as IntersectionObserver);
      callbacks[1](intersect, {} as IntersectionObserver);
      expect(loads).toBe(3);
      shelf.destroy(); sentinel.destroy();
      expect(disconnected).toBe(3);
    } finally { globalThis.IntersectionObserver = original; }
  });
});
