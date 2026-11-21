<script lang="ts">
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import Field from './Field.svelte';
  import { createOperation } from '#lib/ui/operation.svelte.js';
  import { onDestroy, untrack } from 'svelte';
  import type { MediaView } from '#lib/ui/types.js';
  import { useClient } from '#lib/ui/client-context.js';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import { canRequestSeason, requestQualityStatus, requestSeasonStatus, type RequestDestination } from '#lib/media/requests.js';
  import { createRequestOptions } from '#lib/ui/controls/request-options.svelte.js';

  const { api, change } = useClient();
  const operation = createOperation(useRetention());
  const read = createRequestOptions(api);
  onDestroy(read.dispose);
  const busy = $derived(operation.busy);

  let {
    item,
    seasonNumber,
    initial4k = false,
    initialSeasons,
    options,
    onsent,
    open = $bindable(false),
  }: {
    item: MediaView;
    seasonNumber?: number;
    open: boolean;
    initial4k?: boolean;
    initialSeasons?: readonly number[];
    options?: RequestDestination[];
    onsent?: () => void;
  } = $props();
  let destination = $state(''),
    is4k = $state(false),
    watchlist = $state(true),
    selected = $state<number[]>([]),
    error = $state('');
  const destinations = $derived(initial4k
    ? (read.value ?? []).filter(entry => entry.variants.fourK)
    : read.value ?? []);
  const loaded = $derived(read.value !== undefined);
  const failure = $derived(error || read.error);
  const active = $derived(destinations.find((d) => d.id === destination));
  const variant = $derived(is4k ? active?.variants.fourK : active?.variants.standard);
  const selectable = $derived(new Set((variant?.seasons ?? []).filter(season => canRequestSeason(variant, season)).map(season => season.number)));
  const canSubmit = $derived(!!variant?.requestable && (item.kind !== 'show' || (selected.length > 0 && selected.every(number => selectable.has(number)))));
  function chooseSeasons() {
    const initial = initialSeasons && is4k === initial4k ? initialSeasons : seasonNumber === undefined ? [] : [seasonNumber];
    selected = initial.filter(number => selectable.has(number));
  }
  function chooseDestination() {
    const selectedDestination = destinations.find((d) => d.id === destination);
    is4k =
      initial4k ||
      (!selectedDestination?.variants.standard?.requestable &&
        !!selectedDestination?.variants.fourK?.requestable);
    chooseSeasons();
  }
  function load() {
    error = '';
    selected = [];
    return read.load(item.id, options);
  }
  $effect(() => {
    if (open) {
      item.id;
      seasonNumber;
      options;
      initial4k;
      initialSeasons;
      untrack(() => void load());
    }
    return read.cancel;
  });
  $effect(() => {
    const values = read.value;
    initial4k; initialSeasons; seasonNumber;
    if (open && values !== undefined) untrack(() => {
      const intent = initialSeasons ?? (seasonNumber === undefined ? [] : [seasonNumber]);
      const quality = initial4k ? 'fourK' : 'standard';
      const match = (key: 'standard' | 'fourK') => {
        const candidates = destinations.filter(entry => entry.variants[key]?.requestable);
        const canSelect = (entry: RequestDestination, number: number) => entry.variants[key]?.seasons.some(
          season => season.number === number && canRequestSeason(entry.variants[key], season));
        return candidates.find(entry => intent.every(number => canSelect(entry, number)))
          ?? candidates.find(entry => intent.some(number => canSelect(entry, number)));
      };
      const primary = match(quality);
      const fallback = !primary && !initial4k ? match('fourK') : undefined;
      const preferred = primary ?? fallback
        ?? destinations.find(entry => intent.some(number => entry.variants[quality]?.seasons.some(season => season.number === number)))
        ?? destinations[0];
      destination = preferred?.id ?? '';
      is4k = initial4k || !!fallback;
      chooseSeasons();
    });
  });
  async function submit() {
    if (busy || !canSubmit) return;

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

  reportFailure(() => open ? {text:failure,retry:error ? undefined : load} : '');
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
    {#if destinations.length}
      <Field label="Destination server"><select bind:value={destination} onchange={chooseDestination}
          >{#each destinations as d}<option value={d.id}>{d.name}</option>{/each}</select
        ></Field>
      {#if active?.variants.fourK}<label class="check"
          ><input
            type="checkbox"
            bind:checked={is4k}
            onchange={chooseSeasons}
          />Request in 4K</label
        >{/if}
      {#if item.kind === 'show'}<div class="stack">
          <h3>Seasons</h3>
          {#each variant?.seasons ?? [] as season}
            {@const status = requestSeasonStatus(season)}
            <label class="check"
              ><input
                type="checkbox"
                bind:group={selected}
                value={season.number}
                disabled={!selectable.has(season.number)}
              />Season {season.number}{#if status === 'Requested'}<small>{season.mine ? 'Requested by you' : 'Requested by someone else'}</small>
                {:else if !selectable.has(season.number)}<small>{status ?? 'Unavailable'}</small>{/if}
            </label>
          {/each}
        </div>{/if}
      {#if !variant?.requestable}<p class="small">
          {requestQualityStatus(active ? [active] : [], is4k ? 'fourK' : 'standard')}.
          Nothing remains to request in this quality. Choose another quality or destination.
        </p>{/if}
      <label class="check"
        ><input type="checkbox" bind:checked={watchlist} />Add to my watchlist</label
      >
      <Button
        type="submit"
        disabled={busy || !canSubmit}
        >{busy ? 'Sending request…' : 'Request'}</Button
      >
    {:else if loaded && !failure}<p>No request destinations are available for your account.</p>{/if}
  </form>
</Dialog>
