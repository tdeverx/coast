<script lang="ts">
  import Field from './Field.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import { createOperation } from '$lib/ui/operation.svelte';
  import { untrack } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import type { RequestDestination } from '$lib/media/requests';

  const { api, change } = useClient();
  const operation = createOperation();
  const busy = $derived(operation.busy);

  let {
    item,
    seasonNumber,
    initial4k = false,
    options,
    onsent,
    open = $bindable(false),
  }: {
    item: MediaView;
    seasonNumber?: number;
    open: boolean;
    initial4k?: boolean;
    options?: RequestDestination[];
    onsent?: () => void;
  } = $props();
  let destinations = $state<RequestDestination[]>([]),
    destination = $state(''),
    is4k = $state(false),
    watchlist = $state(true),
    selected = $state<number[]>([]),
    error = $state(''),
    loaded = $state(false);
  const active = $derived(destinations.find((d) => d.id === destination));
  const variant = $derived(is4k ? active?.variants.fourK : active?.variants.standard);
  function chooseDestination() {
    const selectedDestination = destinations.find((d) => d.id === destination);
    is4k =
      initial4k ||
      (!selectedDestination?.variants.standard?.requestable &&
        !!selectedDestination?.variants.fourK?.requestable);
    const availableVariant = is4k
      ? selectedDestination?.variants.fourK
      : selectedDestination?.variants.standard;
    selected =
      seasonNumber !== undefined &&
      availableVariant?.seasons.some(
        (season) => season.number === seasonNumber && !season.requested && !season.available
      )
        ? [seasonNumber]
        : [];
  }
  let generation = 0;
  async function load() {
    const token = ++generation;
    loaded = false;
    error = '';
    destinations = [];
    selected = [];
    try {
      const result = options
        ? { destinations: options }
        : await api<{ destinations: RequestDestination[] }>(
            `requests/options?mediaId=${item.id}`,
            undefined,
            'GET'
          );
      if (token !== generation) return;
      destinations = initial4k
        ? result.destinations.filter((entry) => entry.variants.fourK?.requestable)
        : result.destinations;
      destination = destinations[0]?.id ?? '';
      chooseDestination();
    } catch (cause) {
      if (token === generation) error = message(cause);
    } finally {
      if (token === generation) loaded = true;
    }
  }
  $effect(() => {
    if (open) {
      item.id;
      seasonNumber;
      options;
      initial4k;
      untrack(() => void load());
    }
    return () => {
      generation++;
    };
  });
  async function submit() {
    if (busy) return;

    error = '';
    const completed = await operation.run(async () => {
      await change('requests', {
        mediaId: item.id,
        instanceId: destination,
        is4k,
        seasons: selected,
        watchlist,
      });
      open = false;
      onsent?.();
    });
    if (!completed) error = operation.error;
  }
</script>

<Dialog bind:open title={`Request ${item.title}`}>
  <form
    class="stack"
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <p class="small">
      Choose where you’d like to watch. Your request stays here while the server prepares it.
    </p>
    {#if error}<RowFeedback error={error} tag="div" class="notice error" />
      <Button emphasis="subtle" onclick={load}>Retry</Button>{/if}
    {#if destinations.length}
      <Field label="Destination server"><select bind:value={destination} onchange={chooseDestination}
          >{#each destinations as d}<option value={d.id}>{d.name}</option>{/each}</select
        ></Field>
      {#if active?.variants.fourK}<label class="check"
          ><input
            type="checkbox"
            bind:checked={is4k}
            onchange={() => {
              const current = is4k ? active?.variants.fourK : active?.variants.standard;
              selected =
                seasonNumber !== undefined &&
                current?.seasons.some(
                  (s) => s.number === seasonNumber && !s.available && !s.requested
                )
                  ? [seasonNumber]
                  : [];
            }}
          />Request in 4K</label
        >{/if}
      {#if item.kind === 'show'}<div class="stack">
          <h3>Seasons</h3>
          {#each variant?.seasons ?? [] as season}<label class="check"
              ><input
                type="checkbox"
                bind:group={selected}
                value={season.number}
                disabled={season.requested || season.available}
              />Season {season.number}{#if season.available}<small>Available</small
                >{:else if season.requested}<small
                  >{season.mine ? 'Requested by you' : 'Requested by someone else'}</small
                >{/if}</label
            >{/each}
        </div>{/if}
      {#if !variant?.requestable}<p class="small">
          Nothing remains to request in this quality. Choose another quality or destination.
        </p>{/if}
      <label class="check"
        ><input type="checkbox" bind:checked={watchlist} />Add to my watchlist</label
      >
      <Button
        type="submit"
        disabled={busy || !variant?.requestable || (item.kind === 'show' && !selected.length)}
        >{busy ? 'Sending request…' : 'Request'}</Button
      >
    {:else if loaded && !error}<p>No request destinations are available for your account.</p>{/if}
  </form>
</Dialog>
