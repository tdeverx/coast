<script module lang="ts">
  export type QueueAction = {
    id: string;
    kind: string;
    state: string;
    attempts: number;
    lastError: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    nextAttemptAt?: Date | string;
    connectionLabel?: string;
    instanceId?: string | null;
    progress?: { processed?: number; total?: number | null; phase?: string } | null;
  };
</script>

<script lang="ts">
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { change, message } from '$lib/ui/client';
  import EmptyState from './EmptyState.svelte';
  import QueueJob from './QueueJob.svelte';
  let {
    actions,
    compact = false,
    emptyTitle = 'No pending jobs',
    emptyDescription = 'Jobs for connected services appear here. Coast will retry automatically if a service is unavailable.',
  }: {
    actions: QueueAction[];
    compact?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
  } = $props();
  let error = $state('');
  let pending = $state<string[]>([]);
  async function update(id: string, action: 'retry' | 'cancel') {
    if (pending.includes(id)) return;
    pending = [...pending, id];
    error = '';
    try {
      await change(`queue/${id}/${action}`, {});
      notifyAction(action === 'retry' ? 'Job queued for retry.' : 'Job cancelled.');
    } catch (cause) {
      error = message(cause);
    } finally {
      pending = pending.filter((value) => value !== id);
    }
  }
</script>

{#if error}<div class="notice error" role="alert">{error}</div>{/if}
{#if actions.length}<div class="queue">
    {#each actions as action (action.id)}<QueueJob
        {action}
        {compact}
        busy={pending.includes(action.id)}
        {update}
      />{/each}
  </div>
{:else}<EmptyState title={emptyTitle} description={emptyDescription} icon="clock" />{/if}
