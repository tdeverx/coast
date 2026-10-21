<script lang="ts">
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import { page } from '$app/state';
  import type { ComponentProps } from 'svelte';
  import Button from './Button.svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { createMutation } from '#lib/ui/mutation.svelte.js';
  import Rating from './Rating.svelte';
  import RecommendAction from './RecommendAction.svelte';
  import ReactionActions from './ReactionActions.svelte';
  let { section, workId, disabled = false, rating = null, onrated, controls = [], recommendationIds = [] }: {
    section: 'recommendations' | 'social' | 'rating' | 'relationships';
    workId: string; disabled?: boolean; rating?: number | null; onrated?: (value: number | null) => void;
    recommendationIds?: string[];
    controls?: ComponentProps<typeof Button>[];
  } = $props();
  const {changeMany}=useClient();
  const mutation=createMutation(async()=>{}, useClient().feedback.notify, useRetention());
  async function respond(action:'save'|'dismiss') {
    await mutation.run(()=>changeMany(recommendationIds.map(id=>`social/recommendations/${id}`),{action}),action==='save'?'Recommendation saved.':'Recommendation dismissed.');
  }

  reportFailure(()=>mutation.error);
</script>
{#if section === 'recommendations' && page.data.capabilities?.social!==false}
  <Button item icon="bookmark" disabled={disabled||mutation.busy} onclick={()=>respond('save')}>Save</Button>
  <Button item icon="close" disabled={disabled||mutation.busy} onclick={()=>respond('dismiss')}>Dismiss</Button>

{:else if section === 'social' && page.data.capabilities?.social!==false}
  <RecommendAction {workId} {disabled} /><ReactionActions targetId={workId} {disabled} />
{:else if section === 'rating'}
  <Rating mediaId={workId} value={rating} {onrated} />
{:else if section !== 'social' && section !== 'recommendations'}
  {#each controls as control}<Button {...control} />{/each}
{/if}
