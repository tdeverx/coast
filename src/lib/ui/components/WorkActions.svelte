<script lang="ts">
  import { page } from '$app/state';
  import type { ComponentProps, Snippet } from 'svelte';
  import Button from './Button.svelte';
  import { useClient } from '$lib/ui/client-context';
  import { createMutation } from '$lib/ui/mutation.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import Rating from './Rating.svelte';
  import RecommendAction from './RecommendAction.svelte';
  import ReactionActions from './ReactionActions.svelte';
  let { section, workId, disabled = false, rating = null, onrated, controls = [], recommendationIds = [], empty }: {
    section: 'recommendations' | 'social' | 'rating' | 'relationships' | 'lists';
    workId: string; disabled?: boolean; rating?: number | null; onrated?: (value: number | null) => void;
    recommendationIds?: string[];
    controls?: ComponentProps<typeof Button>[]; empty?: Snippet;
  } = $props();
  const {change}=useClient();
  const mutation=createMutation(async()=>{});
  async function respond(action:'save'|'dismiss') {
    await mutation.run(async()=>{for(const id of recommendationIds)await change(`social/recommendations/${id}`,{action});},action==='save'?'Recommendation saved.':'Recommendation dismissed.');
  }
</script>
{#if section === 'recommendations' && page.data.capabilities?.social!==false}
  <Button item icon="bookmark" disabled={disabled||mutation.busy} onclick={()=>respond('save')}>Save</Button>
  <Button item icon="close" disabled={disabled||mutation.busy} onclick={()=>respond('dismiss')}>Dismiss</Button>
  <RowFeedback error={mutation.error} />
{:else if section === 'social' && page.data.capabilities?.social!==false}
  <RecommendAction {workId} {disabled} /><ReactionActions targetId={workId} {disabled} />
{:else if section === 'rating'}
  <Rating mediaId={workId} value={rating} menu {onrated} />
{:else if section !== 'social' && section !== 'recommendations'}
  {#each controls as control}<Button {...control} />{:else}{@render empty?.()}{/each}
{/if}
