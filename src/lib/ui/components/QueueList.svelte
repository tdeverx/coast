<script lang="ts">
  import { untrack } from 'svelte';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { change, message } from '$lib/ui/client';
  import EmptyState from './EmptyState.svelte';
  import { jobWaiting, jobOutcome, jobRemedy, type QueueAction } from '$lib/ui/queue';
  import { displayLabel } from '$lib/ui/labels';
  import { contextGesture } from '$lib/ui/context-gesture';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
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
  let menus = $state<Record<string, ContextMenu | undefined>>({});
  let error = $state('');
  let pending = $state<string[]>([]);
  $effect(() => {
    const ids = new Set(actions.map(action => action.id));
    untrack(() => { for (const id of Object.keys(menus)) if (!ids.has(id)) delete menus[id]; });
  });
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
    {#each actions as action (action.id)}{@const waiting = jobWaiting(action)}
<div class="row action" class:compact use:contextGesture={(point) => menus[action.id]?.openAt(point)}>
  <div class="details">
    <h3>{displayLabel(action.kind)}</h3>
    {#if action.connectionLabel}<p>{action.connectionLabel}</p>{/if}
    <p>
      {action.state === 'pending' && action.attempts > 0
        ? 'Waiting to retry'
        : waiting
          ? 'Waiting for service'
          : action.state === 'failed'
            ? 'Needs attention'
            : displayLabel(action.state)} · {action.attempts}
      {action.attempts === 1 ? 'attempt' : 'attempts'}
    </p>
    {#if action.createdAt}<p>
        Queued {new Date(action.createdAt).toLocaleString()}{#if waiting && action.nextAttemptAt}
          · Next attempt {new Date(action.nextAttemptAt).toLocaleString()}{/if}
      </p>{/if}
    {#if jobOutcome(action)}<p>{jobOutcome(action)}</p>{/if}
    {#if action.lastError}<p class="job-error">{action.lastError}</p>{/if}
  </div>
  {#if ['pending', 'failed'].includes(action.state)}
    <ContextMenu
      bind:this={menus[action.id]}
      label={`${displayLabel(action.kind)} job actions`}
      disabled={pending.includes(action.id)}
    >
      {#if jobRemedy(action) === 'connection'}<MenuAction icon="user" href="/settings/connections" keepOpen={false}>Reconnect account</MenuAction>
      {:else if jobRemedy(action) === 'permissions'}<MenuAction icon="settings" href="/settings/integrations" keepOpen={false}>Review permissions</MenuAction>
      {:else if jobRemedy(action) === 'metadata'}<MenuAction icon="list" href="/settings/activity" keepOpen={false}>Review diagnostics</MenuAction>
      {:else if action.state === 'failed' || action.attempts > 0}<MenuAction
          icon="refresh"
          keepOpen={false}
          onclick={() => void update(action.id, 'retry')}
          >{action.state === 'failed' ? 'Retry' : 'Retry now'}</MenuAction
        >{/if}
      <MenuAction
        icon="close"
        keepOpen={false}
        danger
        onclick={() => void update(action.id, 'cancel')}>Cancel job</MenuAction
      >
    </ContextMenu>
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
