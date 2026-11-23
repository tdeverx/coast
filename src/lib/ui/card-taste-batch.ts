import { maxTasteBatchSize, type CardTasteResponse } from '#lib/social/card-taste.js';

type Listener = (score: number | undefined) => void;
type Read = (ids: string[], signal: AbortSignal) => Promise<CardTasteResponse>;

/** One viewer's visible cards share a request and a bounded cache, including unscored titles. */
export function createCardTasteBatch(read: Read) {
  const listeners = new Map<string, Set<Listener>>();
  const cache = new Map<string, {value:number | undefined; revision:string | undefined}>();
  let revision: string | undefined;
  const queued = new Set<string>();
  let active: { ids: string[]; controller: AbortController } | undefined;
  let scheduled = false;
  const waiting = new Set<string>();
  let retry:ReturnType<typeof setTimeout> | undefined;
  let retryDelay=2000;
  function retryPending() {
    if (!waiting.size || retry || disposed) return;
    retry=setTimeout(()=>{
      retry=undefined;
      for (const id of waiting) if (listeners.has(id)) queued.add(id);
      waiting.clear();
      retryDelay=Math.min(30000,2*retryDelay);
      if (queued.size) schedule();
    },retryDelay);
  }
  let disposed = false;

  function schedule() {
    if (!scheduled && !disposed) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  function flush() {
    scheduled = false;
    if (disposed) return;
    if (active) {
      if (active.ids.some(id => listeners.has(id))) return;
      active.controller.abort();
      active = undefined;
    }
    if (!queued.size) return;
    const ids = Array.from(queued).slice(0, maxTasteBatchSize);
    for (const id of ids) queued.delete(id);
    const request = { ids, controller: new AbortController() };
    active = request;
    void read(ids, request.controller.signal).then(({ scores, pending }) => {
      if (active !== request || disposed) return;
      const unresolved=new Set(pending);
      for (const id of ids) {
        if (unresolved.has(id)) {
          cache.delete(id);
          for (const listener of listeners.get(id) ?? []) listener(undefined);
          if (listeners.has(id)) waiting.add(id);
          continue;
        }
        waiting.delete(id);
        const value = scores[id];
        cache.set(id, {value, revision});
        for (const listener of listeners.get(id) ?? []) listener(value);
      }
      if (pending?.length) retryPending();
      else if (!waiting.size) retryDelay=2000;
      while (cache.size > 4 * maxTasteBatchSize) cache.delete(cache.keys().next().value!);
    }).catch(() => {
      // Optional subtitles can retry when the card next enters the viewport.
    }).finally(() => {
      if (active !== request) return;
      active = undefined;
      if (queued.size) schedule();
    });
  }

  function watch(id: string, listener: Listener) {
    if (disposed) return () => {};
    let group = listeners.get(id);
    if (!group) listeners.set(id, group = new Set());
    group.add(listener);
    const cached = cache.get(id);
    if (cached) {
      cache.delete(id);
      cache.set(id, cached);
      listener(cached.value);
    }
    if ((!cached || cached.revision !== revision) && !waiting.has(id) && !active?.ids.includes(id)) {
      queued.add(id);
      schedule();
    }
    return () => {
      group.delete(listener);
      if (group.size || listeners.get(id) !== group) return;
      listeners.delete(id);
      waiting.delete(id);
      queued.delete(id);
      if (active?.ids.includes(id)) schedule();
    };
  }

  function refresh(next: string) {
    if (disposed || revision === next) return;
    const initial = revision === undefined;
    revision = next;
    if (initial) return;
    active?.controller.abort();
    active = undefined;
    for (const id of listeners.keys()) queued.add(id);
    if (queued.size) schedule();
  }

  function dispose() {
    disposed = true;
    active?.controller.abort();
    active = undefined;
    clearTimeout(retry);
    waiting.clear();
    listeners.clear();
    queued.clear();
    cache.clear();
  }
  return { watch, peek:(id:string) => cache.get(id)?.value, refresh, dispose };
}
