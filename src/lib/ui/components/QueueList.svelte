<script lang="ts">
  import RowFeedback from './RowFeedback.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { untrack } from 'svelte';
  import { createQueueActions } from '$lib/ui/controls/queue.svelte';
  import EmptyState from './EmptyState.svelte';
  import { jobWaiting, jobOutcome, jobRemedy, jobWaitingReason, jobPurposeLabel, type QueueAction } from '$lib/ui/queue';
  import { displayLabel } from '$lib/ui/labels';
  import { contextGesture } from '$lib/ui/context-gesture';
  const queue = createQueueActions();




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
  let menus = $state<Record<string, Button | undefined>>({});
  const error = $derived(queue.error);
  $effect(() => {
    const ids = new Set(actions.map(action => action.id));
    untrack(() => { for (const id of Object.keys(menus)) if (!ids.has(id)) delete menus[id]; });
  });
  const update = queue.run;

</script>

{#if error}<RowFeedback error={error} tag="div" class="notice error" />{/if}
{#if actions.length}<div class="queue">
    {#each actions as action (action.id)}{@const waiting = jobWaiting(action)}
<div class="row action" class:compact use:contextGesture={(point) => menus[action.id]?.openAt(point)}>
  <div class="details">
    <h3>{displayLabel(action.kind)}</h3>
    {#if action.connectionLabel}<p>{action.connectionLabel}</p>{/if}
    <p>
      {[jobWaitingReason(action) ?? (action.state === 'failed' ? 'Needs attention' : displayLabel(action.state)), jobPurposeLabel(action)].filter(Boolean).join(' · ')} · {action.attempts}
      {action.attempts === 1 ? 'attempt' : 'attempts'}
    </p>
    {#if action.createdAt}<p>
        Queued {new Date(action.createdAt).toLocaleString()}{#if waiting && action.nextAttemptAt}
          · Next attempt {new Date(action.nextAttemptAt).toLocaleString()}{/if}
      </p>{/if}
    {#if jobOutcome(action)}<p>{jobOutcome(action)}</p>{/if}
    {#if action.lastError}<p class="job-error">{action.lastError}</p>{/if}
  </div>
  {#if ['pending', 'running', 'failed'].includes(action.state)}
    <Button menu
      bind:this={menus[action.id]}
      label={`${displayLabel(action.kind)} job actions`}
      disabled={queue.busy(action.id)}
    >
      {#if ['pending', 'running'].includes(action.state) && (!action.failure || action.failure.retryable)}<Button item icon="clock" keepOpen={false} onclick={() => void update(action.id, 'promote')}>Prioritize</Button>{/if}
      {#if jobRemedy(action) === 'connection'}<Button item icon="user" href="/settings/connections" keepOpen={false}>Reconnect account</Button>
      {:else if jobRemedy(action) === 'permissions'}<Button item icon="settings" href="/settings/integrations" keepOpen={false}>Review permissions</Button>
      {:else if jobRemedy(action) === 'metadata'}<Button item icon="list" href="/settings/activity" keepOpen={false}>Review diagnostics</Button>
      {/if}
      {#if action.kind === 'benchmark.run'}<Button item icon="refresh" href="/settings/benchmarks" keepOpen={false}>Run a new benchmark</Button>
      {:else if action.state !== 'running' && (action.state === 'failed' || action.attempts > 0)}<Button item
          icon="refresh"
          keepOpen={false}
          onclick={() => void update(action.id, 'retry')}
          >{action.state === 'failed' ? 'Retry' : 'Retry now'}</Button>{/if}
      {#if ['pending', 'failed'].includes(action.state)}<Button item
        icon="close"
        keepOpen={false}
        danger
        onclick={() => void update(action.id, 'cancel')}>Cancel job</Button>{/if}
    </Button>
  {/if}
</div>
{/each}
  </div>
{:else}<EmptyState title={emptyTitle} description={emptyDescription} icon="clock" />{/if}

<style>
  .action {
    padding: 16px 0;
    border-bottom: 1px solid var(--line);
    align-items: flex-start;
    flex-wrap: nowrap;
  }
  .details {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: var(--text-sm);
    margin: 0;
  }
  p {
    font-size: var(--text-sm);
    color: var(--muted);
    margin: 6px 0 0;
  }
  .job-error {
    color: var(--ink);
  }
  .compact {
    padding: 12px 0;
  }
</style>
