<script lang="ts">
  import { displayLabel } from '$lib/ui/labels';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { change, message } from '$lib/ui/client';
  import Button from './Button.svelte';
  import EmptyState from './EmptyState.svelte';
  type QueueAction = {
    id: string;
    kind: string;
    state: string;
    attempts: number;
    lastError: string | null;
    createdAt?: Date | string;
    nextAttemptAt?: Date | string;
    connectionLabel?: string;
  };
  let {
    actions,
    emptyTitle = 'No pending jobs',
    emptyDescription = 'Jobs for connected services appear here. Coast will retry automatically if a service is unavailable.',
  }: { actions: QueueAction[]; emptyTitle?: string; emptyDescription?: string } = $props();
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

{#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if actions.length}<div
    class="queue"
  >
    {#each actions as action}<div class="row action">
        <div style="flex:1">
          <h3>{displayLabel(action.kind)}</h3>
          {#if action.connectionLabel}<p>{action.connectionLabel}</p>{/if}
          <p>
            {displayLabel(action.state)} · {action.attempts}
            {action.attempts === 1 ? 'attempt' : 'attempts'}
          </p>
          {#if action.createdAt}<p>
              Queued {new Date(
                action.createdAt
              ).toLocaleString()}{#if action.state === 'pending' && action.nextAttemptAt && new Date(action.nextAttemptAt).getTime() > Date.now()}
                {' · Next attempt '}{new Date(action.nextAttemptAt).toLocaleString()}{/if}
            </p>{/if}
          {#if action.lastError}<small>{action.lastError}</small>{/if}
        </div>
        {#if ['pending', 'failed'].includes(action.state)}{#if action.state === 'failed'}<Button
              variant="secondary"
              disabled={pending.includes(action.id)}
              onclick={() => update(action.id, 'retry')}>Retry</Button
            >{/if}<Button
            variant="danger"
            disabled={pending.includes(action.id)}
            onclick={() => update(action.id, 'cancel')}>Cancel job</Button
          >{/if}
      </div>{/each}
  </div>{:else}<EmptyState title={emptyTitle} description={emptyDescription} icon="clock" />{/if}

<style>
  .action {
    padding: 20px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .action h3 {
    font-size: 12px;
  }
  .action p {
    font-size: 10px;
    margin: 6px 0;
  }
  .action small {
    overflow-wrap: anywhere;
  }
  .action > div {
    min-width: 160px;
  }
</style>
