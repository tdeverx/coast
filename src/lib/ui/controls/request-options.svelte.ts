import type { RequestDestination } from '#lib/media/requests.js';
import type { api } from '#lib/ui/client.js';
import { createResource } from '#lib/ui/resource.svelte.js';

/** Menu and dialog reads share publication/cancellation policy, not a global cache. */
export function createRequestOptions(request: typeof api) {
  const resource = createResource<RequestDestination[] | undefined>(undefined);
  function reset() { resource.replace(undefined); }
  function load(mediaId: string, provided?: RequestDestination[], current = () => true) {
    reset();
    if (provided !== undefined) { resource.replace(provided); return Promise.resolve(provided); }
    return resource.load(async signal => {
      const result = await request<{ destinations: RequestDestination[] }>(
        `requests/options?mediaId=${mediaId}`, undefined, 'GET', { signal }
      );
      return result.destinations;
    }, { usable: current });
  }
  return { load, reset, cancel: resource.cancel, dispose: resource.dispose,
    get value() { return resource.data; }, get busy() { return resource.busy; }, get error() { return resource.error; }
  };
}
