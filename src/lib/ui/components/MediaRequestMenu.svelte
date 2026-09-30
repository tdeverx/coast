<script lang="ts">
  import type { MediaActionData } from '$lib/media/actions';
  import type { MediaView } from '$lib/ui/types';
  import { requestScope, type RequestDestination } from '$lib/media/requests';
  import { api, message } from '$lib/ui/client';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import Icon from './Icon.svelte';
  let {
    item,
    data,
    busy,
    loading,
    error,
    onrequest,
    onmanage,
  }: {
    item: MediaView | null;
    data: MediaActionData | null;
    busy: boolean;
    loading: boolean;
    error: string;
    onrequest: (fourK?: boolean, options?: RequestDestination[]) => void;
    onmanage: (
      request: MediaActionData['requests'][number],
      action: 'cancel' | 'approve' | 'decline'
    ) => void;
  } = $props();
  let requestOptions = $state<RequestDestination[] | undefined>(),
    requestOptionsBusy = $state(false),
    requestOptionsError = $state('');
  let generation = 0;
  export function resetOptions() {
    generation++;
    requestOptions = undefined;
    requestOptionsBusy = false;
    requestOptionsError = '';
  }
  const existingRequests = $derived(data?.requests ?? []);
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
        : item?.available || existingRequests.length
          ? 'Request more'
          : 'Request'
  );
  const requestDisabledReason = $derived(
    !data
      ? 'Checking request availability'
      : !data.requestsEnabled
        ? 'Connect Seerr and enable requests'
        : !item?.tmdbId
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
    if (requestOptionsBusy || requestOptions || requestDisabledReason || !item) return;
    const id = item.id;
    const token = ++generation;
    requestOptionsBusy = true;
    requestOptionsError = '';
    try {
      const result = await api<{ destinations: RequestDestination[] }>(
        `requests/options?mediaId=${id}`,
        undefined,
        'GET'
      );
      if (item?.id === id && token === generation) requestOptions = result.destinations;
    } catch (cause) {
      if (token === generation) requestOptionsError = message(cause);
    } finally {
      if (token === generation) requestOptionsBusy = false;
    }
  }
  function openRequest(fourK = false) {
    onrequest(fourK, requestOptions);
  }
</script>

{#snippet requestManagement(request: MediaActionData['requests'][number])}
  {#if request.canApprove}<MenuAction
      icon="check"
      disabled={busy}
      onclick={() => onmanage(request, 'approve')}>Approve request…</MenuAction
    >{/if}
  <MenuAction icon="arrow" href={`/requests?request=${request.id}`}
    >View request · {request.state === 'pending'
      ? 'Pending'
      : request.state === 'approved'
        ? 'Approved'
        : request.state === 'available'
          ? 'Available'
          : 'Failed'}</MenuAction
  >
  {#if request.canCancel || request.canDecline}<div
      class="menu-divider"
      role="separator"
    ></div>{/if}
  {#if request.canDecline}<MenuAction
      icon="close"
      danger
      disabled={busy}
      onclick={() => onmanage(request, 'decline')}>Decline request…</MenuAction
    >{/if}
  {#if request.canCancel}<MenuAction
      icon="close"
      danger
      disabled={busy}
      onclick={() => onmanage(request, 'cancel')}>Cancel request…</MenuAction
    >{/if}
{/snippet}
{#snippet choices()}
  {#if error}<div class="menu-feedback text-danger" role="alert">{error}</div>{/if}
  {#if canRequestStandard}
    <MenuAction icon="request" onclick={() => openRequest()}
      >{item?.kind === 'show'
        ? 'Request remaining seasons…'
        : 'Request standard version…'}</MenuAction
    >
  {/if}
  {#if canRequest4k}<MenuAction icon="request" onclick={() => openRequest(true)}
      >Request 4K…</MenuAction
    >{/if}
  {#if requestOptionsError}<MenuAction icon="refresh" onclick={loadRequestOptions}
      >Retry request options</MenuAction
    >{/if}
  {#if existingRequests.length}
    {#if canRequestStandard || canRequest4k || requestOptionsError}<div
        class="menu-divider"
        role="separator"
      ></div>{/if}
    {#if existingRequests.length === 1}
      {@render requestManagement(existingRequests[0])}
    {:else}
      {#each existingRequests as request (request.id)}
        <ContextMenu label={requestScope(request, existingRequests)} panel>
          {#snippet trigger()}<Icon name="request" /><span class="menu-action-label"
              >{requestScope(request, existingRequests)}</span
            ><span class="menu-chevron"><Icon name="right" /></span>{/snippet}
          {@render requestManagement(request)}
        </ContextMenu>
      {/each}
    {/if}
  {:else}
    {#if canRequestStandard || canRequest4k}<div
        class="menu-divider"
        role="separator"
      ></div>{/if}
    <MenuAction icon="arrow" href="/requests">View requests</MenuAction>
    {#if requestOptions && !canRequestStandard && !canRequest4k}<MenuAction
        disabled
        disabledReason="Already available, requested, or not permitted for your account"
        >Nothing more to request</MenuAction
      >{/if}
  {/if}
{/snippet}

{#if canManageRequests || (!requestDisabledReason && requestLabel !== 'Request')}
  <ContextMenu
    label={requestLabel}
    icon="request"
    panel
    disabled={busy || loading}
    onopen={() => void loadRequestOptions()}
  >
    {@render choices()}
  </ContextMenu>
{:else}
  <MenuAction
    icon="request"
    disabled={loading || busy || !!requestDisabledReason}
    disabledReason={requestDisabledReason}
    onclick={() => openRequest()}>{requestLabel}…</MenuAction
  >
{/if}
