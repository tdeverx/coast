<script lang="ts">
  import { displayLabel } from '$lib/ui/labels';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { change, message } from '$lib/ui/client';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  let { data } = $props();
  let error = $state(''),
    cancelId = $state(''),
    busy = $state(false);
  const requestById = $derived(new Map(data.requests.map((request) => [request.id, request])));
  const items = $derived(
    data.requests.flatMap((request) =>
      request.item ? [{ ...request.item, entryId: request.id }] : []
    )
  );
</script>

<svelte:head><title>{data.requestId ? 'Request' : 'Requests'} · Coast</title></svelte:head>
<div class="content page route-content">
  <Heading variant="page"
    title={data.requestId ? 'Request' : 'Requests'}
    description={data.requestId
      ? 'Request status and details.'
      : 'Track requested titles and their availability.'}
  >
    {#snippet actions()}
      {#if data.requestId}<Button href="/requests"  icon="left"
          >All requests</Button
        >
      {:else}<Button href="/discover"  icon="discover">Discover titles</Button
        >{/if}
    {/snippet}
  </Heading>
  {#if error}<div class="notice error" role="alert">
      {error}
    </div>{/if}{#if data.requests.length}<Shelf
      title={data.requestId ? 'Requested title' : 'Your requests'}
      {items}
      layout="grid"
      availability={false}
     filterBy="type">
      {#snippet details(item)}{@const request = requestById.get(item.entryId!)!}
        <div class="request-details stack">
          <span class="badge" class:available={request.state === 'available'}
            >{request.state === 'pending' ? 'Pending approval' : displayLabel(request.state)}</span
          >
          <p class="small">
            {request.destination}{request.is4k ? ' · 4K' : ''}{request.seasons.length
              ? ` · Seasons ${request.seasons.join(', ')}`
              : ''}
          </p>
          <p class="small">Requested {new Date(request.createdAt).toLocaleDateString()}</p>
          {#if ['pending', 'approved'].includes(request.state)}<Button
              danger
              disabled={busy}
              onclick={() => (cancelId = request.id)}>Cancel request</Button
            >{/if}
        </div>
      {/snippet}
    </Shelf>{:else}<EmptyState
      title="No requests yet"
      description="Find an unavailable title and request it from a connected Seerr server. You’ll see its progress here."
      icon="request"><Button href="/discover">Discover titles</Button></EmptyState
    >{/if}
  <Pagination
    page={data.page}
    pages={data.pages}
    pageUrl={(page) => `/requests?page=${page}`}
    label="Request pages"
  />
</div>
<Dialog onclose={() => (cancelId = '')} open={!!cancelId} title="Cancel this request?"
  ><div class="stack">
    <p>
      Coast will ask the destination server to cancel your request. Requests owned by someone else
      cannot be cancelled here.
    </p>
    <div class="row">
      <Button
        danger
        disabled={busy}
        onclick={async () => {
          if (busy) return;
          busy = true;
          try {
            await change(`requests/${cancelId}`, { action: 'cancel' });
            cancelId = '';
          } catch (e) {
            error = message(e);
            cancelId = '';
          } finally {
            busy = false;
          }
        }}>Cancel request</Button
      ><Button  onclick={() => (cancelId = '')}>Keep request</Button>
    </div>
  </div></Dialog
>

<style>
  .request-details {
    gap: 10px;
    margin-top: 14px;
    align-items: start;
  }
  .request-details p {
    overflow-wrap: anywhere;
  }
</style>
