<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { displayLabel } from '#lib/ui/labels.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import TasteBreakdown from './TasteBreakdown.svelte';
  import type { scoreTaste } from '#lib/social/taste-profile.js';
  import type { CollectionTaste, TasteGroup } from '#lib/social/collection-taste.server.js';

  let { workId, group, rating, adminTitle, onclose }: {
    workId: string; group?: TasteGroup; rating?: number | null; adminTitle?: string; onclose?: () => void;
  } = $props();
  const { api } = useClient();
  const match = createResource<{ match: ReturnType<typeof scoreTaste> | CollectionTaste | null }>({ match: null });
  let open = $state(false);
  const result = $derived(match.data.match);
  const personalRating = $derived(!group ? rating : null);
  const members = $derived(result && 'members' in result ? result.members : null);
  function load() {
    const params = new URLSearchParams({ workId });
    if (group) params.set('group', group);
    const path = adminTitle === undefined ? 'profile/taste-match' : 'admin/taste-score';
    return match.load(signal => api(`${path}?${params}`, undefined, 'GET', { signal }));
  }
  function show() { open = true; void load(); }
  function close() { match.cancel(); onclose?.(); }
  onMount(() => { if (adminTitle !== undefined) show(); });
  onDestroy(match.dispose);
</script>

{#if adminTitle === undefined}<Button emphasis="subtle" icon="heart" onclick={show}>Taste match</Button>{/if}
{#if open || match.activated}
  <Dialog bind:open wide={adminTitle !== undefined} title={adminTitle === undefined ? 'Taste match' : `Taste score · ${adminTitle}`} onclose={close}>
    {#if match.busy}<p role="status">Checking your taste…</p>
    {:else if match.error}<p role="alert">{match.error}</p><Button onclick={() => void load()}>Retry</Button>
    {:else}
      {#if personalRating != null || result?.score != null}
        <MetricGrid items={[
          ...(personalRating != null ? [{ label: 'Your rating', value: `${personalRating.toLocaleString()} / 5` }] : []),
          ...(result?.score != null ? [{ label: 'Fit with your history', value: `${result.score}%`, detail: '50% is neutral' }] : []),
          ...(result?.score != null && 'confidence' in result ? [{ label: 'Evidence strength', value: `${result.confidence}%` }] : []),
          ...(adminTitle !== undefined && result && !result.breakdown && 'ratingAdjustment' in result && result.ratingAdjustment
            ? [{ label: 'Learned adjustment', value: `${result.ratingAdjustment > 0 ? '+' : '−'}${Math.abs(result.ratingAdjustment)} points` }]
            : []),
        ]} />
      {/if}
      {#if result?.score != null}
        {#if 'reasons' in result && result.reasons.length && (adminTitle === undefined || !result.breakdown)}<ul>
          {#each result.reasons as reason (`${reason.dimension}:${reason.name}`)}
            <li>{displayLabel(reason.dimension)} · {reason.name} · {reason.direction === 'negative' ? 'Lower match' : reason.direction === 'positive' ? 'Higher match' : 'Mixed feedback'}{#if adminTitle !== undefined} · {reason.samples} {reason.samples === 1 ? 'title' : 'titles'} in your history{/if}</li>
          {/each}
        </ul>{/if}
      {:else if group}<p>Coast needs enough history to match at least two titles and half the sample.</p>
      {:else}<p>Coast needs more shared signals between this title and your tracked interests.</p>{/if}
    {/if}
    {#if !match.busy && !match.error && members}
      <p>Matched {members.matched} of {members.sampled} {group === 'reading-group' ? 'known issues' : 'titles'}.{members.sampled < members.total ? ` Sampled from ${members.total} in the catalogue.` : ''}</p>
    {/if}
    {#if adminTitle !== undefined && !match.busy && !match.error && result?.breakdown}
      <TasteBreakdown breakdown={result.breakdown} score={result.score} watchedLabel={group === 'collection' ? 'Titles watched' : undefined} />
    {/if}
  </Dialog>
{/if}
