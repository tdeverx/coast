import type { ReadingLocation } from '../model';
import { sameReadingLocation } from '../model';
import type { ReaderEngine, ReaderOptions } from './engine';
import { readerLoad } from './load';
import { physicalPages } from './physical-pages';
import { createRenderer } from './physical/renderer';
import type { PhysicalState } from './physical/model';
/** Translate physical faces to Coast locations; sessions and saves stay with Reader. */
export async function physicalReader(options: ReaderOptions): Promise<ReaderEngine> {
  const owner = new AbortController();
  const signal = AbortSignal.any([options.signal, owner.signal]);
  const pages = await physicalPages({ ...options, signal });
  options.progress?.({ phase: 'prepare' });
  let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined;
  let state: PhysicalState | undefined;
  let ready = false;
  let fault: unknown;
  let muted = 0;
  let revision = 0;
  let external = 0;
  let navigation = Promise.resolve();
  let lastLocation = options.location;
  let closed = false;
  let leaving: Promise<void> | undefined;
  const cache = new Map<number, Promise<HTMLCanvasElement>>();
  const waiters = new Set<{
    resolve(): void;
    reject(cause: unknown): void;
  }>();
  function settle() {
    for (const waiter of waiters) {
      if (signal.aborted || fault)
        waiter.reject(signal.aborted ? signal.reason : fault);
      else if (!state?.busy)
        waiter.resolve();
      else
        continue;
      waiters.delete(waiter);
    }
  }
  function idle(): Promise<void> {
    signal.throwIfAborted();
    if (fault)
      return Promise.reject(fault);
    if (!state?.busy)
      return Promise.resolve();
    return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
  }
  function changed(next: PhysicalState) {
    const previous = state;
    state = next;
    settle();
    if (!ready || next.busy || muted || external || options.controlled?.() === false)
      return;
    // The entrance shows a closed cover without replacing a saved interior bookmark.
    if (!next.opened && !next.readingCover && !previous?.opened && previous?.backCover === next.backCover)
      return;
    const face = next.opened
      ? next.index + (next.focusedPage === 1 ? 1 : 0)
      : next.backCover ? pages.count - 1 : 0;
    const location = pages.location(face);
    if (!location || sameReadingLocation(lastLocation, location))
      return;
    lastLocation = location;
    options.changed(location);
  }
  function failed(cause: unknown) {
    if (signal.aborted)
      return;
    fault = cause;
    settle();
    if (ready)
      options.failed?.(cause);
  }
  function destroy() {
    if (closed)
      return;
    closed = true;
    owner.abort();
    revision++;
    renderer?.dispose();
    cache.clear();
    signal.removeEventListener('abort', destroy);
    settle();
    void Promise.resolve(pages.close()).catch(() => {
    });
  }
  signal.addEventListener('abort', destroy, { once: true });
  try {
    signal.throwIfAborted();
    const pending = createRenderer(options.host, {
      count: pages.count,
      modelKind: options.kind === 'book' ? 'book' : 'comic',
      title: options.host.getAttribute('aria-label') ?? undefined,
      entrance: true,
      controlled: options.controlled,
      onDismiss: () => {
        if (!signal.aborted)
          options.dismiss?.();
      },
      getPage(index) {
        let page = cache.get(index);
        if (page)
          cache.delete(index);
        else {
          page = pages.page(index, signal);
          void page.catch(() => {
            if (cache.get(index) === page)
              cache.delete(index);
          });
        }
        cache.set(index, page);
        while (cache.size > 8)
          cache.delete(cache.keys().next().value!);
        return page;
      },
      onState: changed,
      onError: failed,
    }).then(value => {
      if (signal.aborted)
        value.dispose();
      else
        renderer = value;
      return value;
    });
    await readerLoad(pending, signal);
    signal.throwIfAborted();
    options.progress?.({ phase: 'render' });
    renderer!.setLight(.5);
    await renderer!.enter(pages.pageFor(options.location));
    await idle();
    ready = true;
    // A following viewer must display the room's location, rather than wait for
    // a cover gesture they cannot make. Local entry remains closed and focused.
    if (options.controlled?.() === false && options.location)
      await go(options.location);
    return {
      previous: () => turn(-1),
      next: () => turn(1),
      canTurn: direction => !leaving && !external && !fault && options.controlled?.() !== false && (!state?.busy || !!state.canCascade && state.cascadeDirection === (direction === 'next' ? 1 : -1)),
      leave() {
        if (!leaving) {
          muted++;
          revision++;
          leaving = (async () => {
            // Closing during a pending turn/load must still cancel immediately.
            if (state?.busy || external || fault || document.hidden)
              return;
            await navigation.catch(() => { });
            await idle();
            signal.throwIfAborted();
            await renderer!.leave();
          })().finally(() => { muted--; });
        }
        return leaving;
      },
      go,
      destroy,
    };
  }
  catch (cause) {
    destroy();
    throw cause;
  }
  async function turn(direction: number) {
    signal.throwIfAborted();
    if (leaving || external || options.controlled?.() === false)
      return;
    await renderer!.turn(direction);
    await idle();
  }
  function go(location: ReadingLocation): Promise<void> {
    if (leaving)
      return Promise.resolve();
    const at = ++revision;
    external++;
    const pending = navigation.catch(() => {
    }).then(async () => {
      await idle();
      if (at !== revision)
        return;
      muted++;
      try {
        await renderer!.showPage(pages.pageFor(location));
        await idle();
        if (at === revision)
          lastLocation = location;
      }
      finally {
        muted--;
      }
    });
    navigation = pending;
    return pending.finally(() => {
      external--;
    });
  }
}
