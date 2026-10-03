import type { MediaActionData } from '$lib/media/actions';
import type { MediaView } from '$lib/ui/types';
import type { RequestDestination } from '$lib/media/requests';
import { message, type api } from '$lib/ui/client';

/** Lazy request state, independent of the button/menu rendering. */
export function createRequestControls(options: {
  item: () => MediaView | null; data: () => MediaActionData | null; api: typeof api;
  onrequest: () => (fourK?: boolean, destinations?: RequestDestination[]) => void;
}) {
  let requestOptions = $state<RequestDestination[] | undefined>(),
    requestOptionsBusy = $state(false),
    requestOptionsError = $state('');
  let generation = 0;
  function resetOptions() {
    generation++;
    requestOptions = undefined;
    requestOptionsBusy = false;
    requestOptionsError = '';
  }
  const existingRequests = $derived(options.data()?.requests ?? []);
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
    if (requestOptionsBusy || requestOptions || requestDisabledReason || !item) return;
    const id = item.id;
    const token = ++generation;
    requestOptionsBusy = true;
    requestOptionsError = '';
    try {
      const result = await options.api<{ destinations: RequestDestination[] }>(
        `requests/options?mediaId=${id}`,
        undefined,
        'GET'
      );
      if (options.item()?.id === id && token === generation) requestOptions = result.destinations;
    } catch (cause) {
      if (token === generation) requestOptionsError = message(cause);
    } finally {
      if (token === generation) requestOptionsBusy = false;
    }
  }
  function openRequest(fourK = false) {
    options.onrequest()(fourK, requestOptions);
  }

 return {resetOptions, loadRequestOptions, openRequest,
get requestOptions() { return requestOptions; },
get requestOptionsError() { return requestOptionsError; },
get existingRequests() { return existingRequests; },
get canManageRequests() { return canManageRequests; },
get requestLabel() { return requestLabel; },
get requestDisabledReason() { return requestDisabledReason; },
get canRequestStandard() { return canRequestStandard; },
get canRequest4k() { return canRequest4k; }
 };
}
