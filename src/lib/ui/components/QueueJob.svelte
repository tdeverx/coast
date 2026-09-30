<script lang="ts">
  import { displayLabel } from '$lib/ui/labels';
  import { contextGesture } from '$lib/ui/context-gesture';
  import type { QueueAction } from './QueueList.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  let {
    action,
    busy,
    update,
    compact,
  }: {
    action: QueueAction;
    busy: boolean;
    compact: boolean;
    update: (id: string, action: 'retry' | 'cancel') => Promise<void>;
  } = $props();
  let menu = $state<ContextMenu>();
  const waiting = $derived(
    action.state === 'pending' &&
      action.nextAttemptAt &&
      new Date(action.nextAttemptAt).getTime() > Date.now()
  );
</script>

<div class="row action" class:compact use:contextGesture={(point) => menu?.openAt(point)}>
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
    {#if action.progress && ['running', 'succeeded'].includes(action.state)}<p>
        {action.progress.processed ?? 0} items{#if action.progress.total != null}
          / {action.progress.total}{/if}{#if action.progress.phase === 'reconciling'}
          · Finishing{/if}
      </p>{/if}
    {#if action.lastError}<p class="job-error">{action.lastError}</p>{/if}
  </div>
  {#if ['pending', 'failed'].includes(action.state)}
    <ContextMenu
      bind:this={menu}
      label={`${displayLabel(action.kind)} job actions`}
      disabled={busy}
    >
      {#if action.state === 'failed' || action.attempts > 0}<MenuAction
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

<style>
  .action {
    padding: 16px 0;
    border-bottom: 1px solid var(--line-soft);
    align-items: flex-start;
    flex-wrap: nowrap;
  }
  .details {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: var(--text-small, 11px);
    margin: 0;
  }
  p {
    font-size: var(--text-small, 11px);
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
