import type { RequestDestination } from '#lib/media/requests.js';
import type { api } from '#lib/ui/client.js';
import { createResource } from '#lib/ui/resource.svelte.js';
import type { retryMenuRead } from './menu-read-retry';

/** Menu and dialog reads share publication/cancellation policy, not a global cache. */
export function createRequestOptions(request: typeof api, retry?: typeof retryMenuRead) {
  const resource = createResource<RequestDestination[] | undefined>(undefined);
  function reset() { resource.replace(undefined); }
  function load(mediaId: string, provided?: RequestDestination[], current = () => true) {
    reset();
    if (provided !== undefined) { resource.replace(provided); return Promise.resolve(provided); }
    return resource.load(async signal => {
      const fetchOptions = () => request<{ destinations: RequestDestination[] }>(
        `requests/options?mediaId=${mediaId}`, undefined, 'GET', { signal }
      );
      try {
        const result = retry ? await retry(fetchOptions, signal, current) : await fetchOptions();
        return result.destinations;
      } catch (cause) {
        if (!signal.aborted && !current()) resource.cancel();
        throw cause;
      }
    }, { usable: current });
  }
  return { load, reset, cancel: resource.cancel, dispose: resource.dispose,
    get value() { return resource.data; }, get busy() { return resource.busy; }, get error() { return resource.error; }
  };
}
