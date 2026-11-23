<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { tasteSignalLabel } from '#lib/social/taste.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import type {PersonalItemMatch} from '#lib/social/taste-personal-match.server.js';
  import FactList from '#lib/ui/components/FactList.svelte';
  import { mediumForTasteKind } from '#lib/social/taste-profile.js';
  import type { CollectionTaste, TasteGroup } from '#lib/social/collection-taste.server.js';
  import { selectedRuleLabels } from '#lib/social/taste-selected.js';

  let { workId, group, kind, rating, inspect, onclose }: {
    workId: string; group?: TasteGroup; kind?: string; rating?: number | null;
    inspect?: { title: string; admin?: boolean; cardScore?: number }; onclose?: () => void;
  } = $props();
  const { api } = useClient();
  const match = createResource<{ match: PersonalItemMatch | CollectionTaste | null }>({ match: null });
  let open = $state(false);
  const result = $derived(match.data.match);
  const selected = $derived(result && 'native' in result ? result : null);
  const personalRating = $derived(!group ? rating : null);
  const members = $derived(result && 'members' in result ? result.members : null);
  const medium = $derived(mediumForTasteKind(kind));
  const loadCollectionBreakdown = () => import('./TasteBreakdown.svelte');
  const points = (value: number) => {
    const rounded = Math.round(value * 10) / 10;
    return (rounded > 0 ? '+' : '') + rounded.toLocaleString() + (Math.abs(rounded) === 1 ? ' point' : ' points');
  };
  function signalFact(signal: PersonalItemMatch['signals'][number]) {
    const family = signal.dimension === 'combination' ? 'Combination' : signal.dimension === 'creators' ? 'Creators' : tasteSignalLabel(signal.dimension, medium);
    const label = signal.groupExample ? family + ' overall' : signal.name;
    const example = signal.groupExample ? ' · Strongest example · ' + signal.groupExample : '';
    return {label, value: points(signal.contribution),
      detail: `${family} · ${signal.works} ${signal.works === 1 ? 'title' : 'titles'} · ${signal.rated} rated · ${Math.round(signal.affinity)}% affinity` + example};
  }
  function load() {
    const params = new URLSearchParams({ workId });
    if (group) params.set('group', group);
    const path = inspect?.admin ? 'admin/taste-score' : 'profile/taste-match';
    if (inspect && !inspect.admin) params.set('breakdown', 'true');
    return match.load(signal => api(`${path}?${params}`, undefined, 'GET', { signal }));
  }
  function show() { open = true; void load(); }
  function close() { match.cancel(); onclose?.(); }
  onMount(() => { if (inspect) show(); });
  onDestroy(match.dispose);
</script>

{#if !inspect}<Button emphasis="subtle" icon="heart" onclick={show}>Taste match</Button>{/if}
{#if open || match.activated}
  <Dialog bind:open wide={!!inspect} title={inspect ? `Taste score · ${inspect.title}` : 'Taste match'} onclose={close}>
    {#if match.busy}<p role="status">Checking your taste…</p>
    {:else if match.error}<p role="alert">{match.error}</p><Button onclick={() => void load()}>Retry</Button>
    {:else}
      {#if personalRating != null || result?.score != null}
        <MetricGrid items={[
          ...(personalRating != null ? [{ label: 'Your rating', value: `${personalRating.toLocaleString()} / 5` }] : []),
          ...(result?.score != null ? [{ label: 'Taste match', value: `${result.score}%`, detail: '50% is neutral' }] : []),
          ...(selected?.native != null && selected.rule && selected.rule!=='personal'
            ? [{label:'Before adjustment',value:`${selected.native}%`,detail:selectedRuleLabels[selected.rule]}] : []),
          ...(result?.score != null && 'confidence' in result ? [{ label: 'Evidence strength', value: `${result.confidence}%` }] : []),
        ]} />
      {/if}
      {#if selected?.score != null}
        {#if selected.withheld}<p class="small muted">This title and its related tracking were held out when learning your preferences.</p>{/if}
      {/if}
      {#if inspect?.cardScore !== undefined && inspect.cardScore !== result?.score}
        <p class="small muted">Your card showed {inspect.cardScore}%. This breakdown uses your current taste profile and the latest title details.</p>
      {/if}
      {#if result?.score != null}
        {#if inspect && selected?.signals.length}
          <h3>Score calculation</h3>
          {#if selected.base != null}<p class="small muted">Starting estimate {Number(selected.base.toFixed(1))}% · {selected.reason}</p>{/if}
          <FactList items={selected.signals.map(signalFact)}/>
        {/if}
      {:else if selected?.pending}<p role="status">Your taste profile is being prepared.</p>
      {:else if group}<p>Coast needs enough history to match at least two titles and half the sample.</p>
      {:else}<p>Coast needs more shared signals between this title and your tracked interests.</p>{/if}
    {/if}
    {#if !match.busy && !match.error && members}
      <p>Matched {members.matched} of {members.sampled} {group === 'reading-group' ? 'known issues' : 'titles'}.{members.sampled < members.total ? ` Sampled from ${members.total} in the catalogue.` : ''}</p>
    {/if}
    {#if inspect && !match.busy && !match.error && result && 'breakdown' in result && result.breakdown}
      {#await loadCollectionBreakdown()}
        <p role="status">Loading the breakdown…</p>
      {:then module}
        <module.default breakdown={result.breakdown} score={result.score} watchedLabel={group === 'collection' ? 'Titles watched' : undefined} />
      {:catch}
        <p role="alert">The score breakdown could not load. Reload the page to try again.</p>
      {/await}
    {/if}
  </Dialog>
{/if}
