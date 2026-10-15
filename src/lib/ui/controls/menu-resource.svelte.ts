import { createResource } from '../resource.svelte';

/** One menu owns one scoped snapshot. Closing cancels reads; writes keep their own lifetime. */
export function createMenuResource<T>(initial: () => T, key: () => string, fetch: (signal: AbortSignal) => Promise<T>) {
  const resource = createResource(initial());
  let scope: string | undefined;
  let ready = false;
  let active = false;
  let disposed = false;
  let pending: Promise<T | undefined> | undefined;
  function sync() {
    const next = key();
    if (scope === next) return;
    scope = next;
    pending = undefined;
    ready = false;
    resource.replace(initial());
  }
  function load(force = false): Promise<T | undefined> {
    if (disposed) return Promise.resolve(undefined);
    sync();
    if (!force && pending) return pending;
    if (!force && ready) return Promise.resolve(resource.data);
    const captured = scope;
    const request = resource.load(async signal => {
      try {
        const value = await fetch(signal);
        if (!signal.aborted && captured !== key()) resource.cancel();
        return value;
      } catch (cause) {
        if (!signal.aborted && captured !== key()) resource.cancel();
        throw cause;
      }
    });
    pending = request;
    void request.then(value => {
      if (pending !== request) return;
      pending = undefined;
      if (captured === key() && value !== undefined) ready = true;
    });
    return request;
  }
  function close() {
    active = false;
    pending = undefined;
    resource.cancel();
  }
  return {
    get data() { return resource.data; },
    get busy() { return resource.busy; },
    get error() { return resource.error; },
    get active() { return active; },
    sync,
    load,
    open() {
      active = true;
      return load();
    },
    close,
    refresh() {
      ready = false;
      return active ? load(true) : Promise.resolve(undefined);
    },
    dispose() {
      disposed = true;
      close();
      resource.dispose();
    },
    replace(value: T) {
      sync();
      pending = undefined;
      resource.replace(value);
      ready = true;
    },
    /** An acknowledged field change cannot make an unfinished snapshot complete. */
    patch(update: (value: T) => T) {
      sync();
      const complete = ready;
      pending = undefined;
      resource.replace(update(resource.data));
      ready = complete;
      if (active && !complete) void load();
    },
  };
}
