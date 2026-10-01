/** A component-local resource: only its latest request may publish state. */
export function createResource<T>(initial: T, ready = false) {
  let data = $state.raw(initial);
  let busy = $state(false);
  let error = $state('');
  let settled = $state(ready);
  let activated = false;
  let controller: AbortController | undefined;

  function cancel() {
    controller?.abort();
    controller = undefined;
    busy = false;
  }
  function replace(value: T, failure = '') {
    cancel();
    data = value;
    error = failure;
    settled = true;
  }
  async function load(
    fetch: (signal: AbortSignal) => Promise<T>,
    options: {
      failure?: (result: T) => string;
      usable?: (result: T) => boolean;
      merge?: (previous: T, result: T) => T;
    } = {}
  ): Promise<T | undefined> {
    cancel();
    activated = true;
    const request = new AbortController();
    controller = request;
    busy = true;
    error = '';
    try {
      const result = await fetch(request.signal);
      if (request.signal.aborted || controller !== request) return;
      error = options.failure?.(result) ?? '';
      if (options.usable && !options.usable(result)) return;
      data = options.merge ? options.merge(data, result) : result;
      settled = true;
      return data;
    } catch (cause) {
      if (!request.signal.aborted && controller === request)
        error = cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
    } finally {
      if (controller === request) {
        controller = undefined;
        busy = false;
      }
    }
  }
  return {
    get data() { return data; },
    get busy() { return busy; },
    get error() { return error; },
    set error(value: string) { error = value; },
    get ready() { return settled; },
    get activated() { return activated; },
    load, replace, cancel,
  };
}

/** Preserve ordered occurrences using the caller's domain identity, not work ID. */
export function uniqueItems<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}
