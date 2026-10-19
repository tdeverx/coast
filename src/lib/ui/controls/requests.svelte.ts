import type { MediaActionData } from '$lib/media/actions';
import type { MediaView } from '$lib/ui/types';
import { requestScopeFormatter, type RequestDestination } from '$lib/media/requests';
import type { api } from '$lib/ui/client';
import { createRequestOptions } from './request-options.svelte';

/** Lazy request state, independent of the button/menu rendering. */
export function createRequestControls(options: {
  item: () => MediaView | null; data: () => MediaActionData | null; api: typeof api;
  onrequest: () => (fourK?: boolean, destinations?: RequestDestination[]) => void;
}) {
  const read = createRequestOptions(options.api);
  const requestOptions = $derived(read.value);
  const cancel = read.cancel, resetOptions = read.reset;
  const existingRequests = $derived(options.data()?.requests ?? []);
  const scopeLabel = $derived(requestScopeFormatter(existingRequests));
  const canManageRequests = $derived(
    existingRequests.some(
      (request) => request.canCancel || request.canApprove || request.canDecline
    )
  );
  const requested = $derived(
    existingRequests.some((request) => ['pending', 'approved'].includes(request.state))
  );
  const requestLabel = $derived(
    canManageRequests
      ? 'Manage request'
      : requested
        ? 'Requested'
        : options.item()?.available || existingRequests.length
          ? 'Request more'
          : 'Request'
  );
  const requestDisabledReason = $derived(
    !options.data()
      ? 'Checking request availability'
      : !options.data()?.requestsEnabled
        ? 'Connect Seerr and enable requests'
        : !options.item()?.tmdbId
          ? 'Match this title with TMDB before requesting it'
          : ''
  );
  const canRequestStandard = $derived(
    requestOptions?.some((entry) => entry.variants.standard?.requestable)
  );
  const canRequest4k = $derived(
    requestOptions?.some((entry) => entry.variants.fourK?.requestable)
  );
  async function loadRequestOptions() {
    const item = options.item();
    if (read.busy || requestOptions || requestDisabledReason || !item) return;
    const id = item.id;
    await read.load(id, undefined, () => options.item()?.id === id);
  }
  function openRequest(fourK = false) {
    options.onrequest()(fourK, requestOptions);
  }

 return {cancel, resetOptions, loadRequestOptions, openRequest,
get requestOptions() { return requestOptions; },
get requestOptionsError() { return read.error; },
get existingRequests() { return existingRequests; },
get scopeLabel() { return scopeLabel; },
get canManageRequests() { return canManageRequests; },
get requestLabel() { return requestLabel; },
get requestDisabledReason() { return requestDisabledReason; },
get canRequestStandard() { return canRequestStandard; },
get canRequest4k() { return canRequest4k; }
 };
}
