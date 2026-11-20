<script lang="ts">
  import { onDestroy } from 'svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { displayLabel } from '#lib/ui/labels.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import type { scoreTaste } from '#lib/social/taste-profile.js';

  let { workId }: { workId: string } = $props();
  const { api } = useClient();
  const match = createResource<{ match: ReturnType<typeof scoreTaste> | null }>({ match: null });
  let open = $state(false);
  const result = $derived(match.data.match);
  function load() {
    return match.load(signal => api(`profile/taste-match?workId=${encodeURIComponent(workId)}`, undefined, 'GET', { signal }));
  }
  onDestroy(match.dispose);
</script>

<Button emphasis="subtle" icon="heart" onclick={() => { open = true; void load(); }}>Taste match</Button>
{#if open}
  <Dialog bind:open title="Taste match" onclose={() => match.cancel()}>
    {#if match.busy}<p role="status">Checking your taste…</p>
    {:else if match.error}<p role="alert">{match.error}</p><Button onclick={() => void load()}>Retry</Button>
    {:else if result && result.score !== null}
      <MetricGrid items={[
        { label: 'Taste match', value: `${result.score}%` },
        { label: 'Confidence', value: `${result.confidence}%` },
      ]} />
      {#if result.reasons.length}<ul>
        {#each result.reasons as reason (`${reason.dimension}:${reason.name}`)}
          <li>{displayLabel(reason.dimension)} · {reason.name}</li>
        {/each}
      </ul>{/if}
      {#if Object.keys(result.dimensions).length}
        <MetricGrid items={Object.entries(result.dimensions).map(([dimension, value]) =>
          ({ label: displayLabel(dimension), value: `${value}%` }))} />
      {/if}
    {:else}<p>Coast needs more shared signals between this title and your tracked interests.</p>{/if}
  </Dialog>
{/if}
