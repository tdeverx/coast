<script lang="ts">
  import Heading from './Heading.svelte';
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { change, message } from '$lib/ui/client';
  import { contextGesture } from '$lib/ui/context-gesture';
  import type { ServiceTask } from '$lib/providers/tasks';
  import type { ProviderSchedule } from '$lib/providers/schedule';
  import Button from './Button.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import Dialog from './Dialog.svelte';
  import RowFilter from './RowFilter.svelte';
  import QueueList from './QueueList.svelte';
  import type { QueueAction } from '$lib/ui/queue';
  let {
    provider,
    task,
    jobs,
    filter = 'active',
  }: {
    provider: {
      id: string;
      name: string;
      provider: string;
      enabled: boolean;
      connectedAccounts: number;
      accounts: { id: string; username: string }[];
      schedule: ProviderSchedule;
      libraryScan?: unknown;
    };
    task: ServiceTask;
    jobs: QueueAction[];
    filter?: string;
  } = $props();
  let open = $state(false),
    history = $state(false),
    busy = $state(false),
    error = $state('');
  let draft = $state<ProviderSchedule>(untrack(() => ({ ...provider.schedule })));
  let saved = $state('');
  let menu = $state<ContextMenu>();
  const dirty = $derived(open && JSON.stringify(draft) !== saved);
  const automatic = $derived(
    provider.enabled &&
      provider.schedule.enabled &&
      (!task.enabled || !!provider.schedule[task.enabled])
  );
  const interval = $derived(task.interval ? provider.schedule[task.interval] : 0);
  const active = $derived(
    jobs.filter((job) => ['pending', 'running', 'failed'].includes(job.state))
  );
  const visible = $derived(
    jobs.filter(
      (job) =>
        filter === 'all' ||
        (filter === 'attention'
          ? job.state === 'failed'
          : filter === 'finished'
            ? ['succeeded', 'cancelled'].includes(job.state)
            : ['pending', 'running', 'failed'].includes(job.state))
    )
  );
  const latest = $derived(jobs.find((job) => job.state === 'succeeded'));
  const progress = $derived(
    provider.libraryScan as
      { fullCompletedAt?: string; processed?: number; total?: number | null } | undefined
  );
  const fields = $derived(
    task.scope === 'library'
      ? ['intervalMinutes', 'fullIntervalHours', 'libraryConnectionId']
      : task.interval
        ? [task.interval]
        : []
  );
  function editSchedule() {
    draft = { ...provider.schedule };
    saved = JSON.stringify(draft);
    error = '';
    open = true;
  }
  async function save() {
    if (busy || !dirty) return;
    busy = true;
    error = '';
    try {
      await change(
        `providers/${provider.id}/schedule`,
        Object.fromEntries(fields.map((field) => [field, draft[field as keyof ProviderSchedule]]))
      );
      saved = JSON.stringify(draft);
      open = false;
      notifyAction('Schedule saved.');
    } catch (cause) {
      error = message(cause);
    } finally {
      busy = false;
    }
  }
  async function run() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const result = await change<{ queued: number; active: number; busy?: boolean }>(
        `providers/${provider.id}/run-job`,
        { task: task.scope }
      );
      notifyAction(
        result.busy
          ? 'Maintenance is already being checked.'
          : `${result.queued} jobs queued${result.active ? `; ${result.active} already active` : ''}.`
      );
    } catch (cause) {
      error = message(cause);
    } finally {
      busy = false;
    }
  }
  beforeNavigate(({ cancel, to }) => {
    if (
      to &&
      to.url.pathname !== window.location.pathname &&
      (busy || (dirty && !window.confirm('Discard unsaved schedule changes?')))
    )
      cancel();
  });
</script>

<article class="panel task-card" aria-label={`${provider.name}: ${task.title}`}>
  <div class="spread task-heading" use:contextGesture={(point) => menu?.openAt(point)}>
    <Heading variant="title" title={task.title} />
    <ContextMenu bind:this={menu} label={`${provider.name} ${task.title} actions`}>
      {#if task.scope}<MenuAction
          icon="refresh"
          keepOpen={false}
          disabled={busy || !provider.enabled || !provider.connectedAccounts}
          disabledReason={!provider.enabled
            ? 'Enable this service in Integrations.'
            : !provider.connectedAccounts
              ? 'Connect an account before running this task.'
              : undefined}
          onclick={() => void run()}>Run now</MenuAction
        >
        <MenuAction
          icon="clock"
          keepOpen={false}
          disabled={busy || !provider.enabled}
          onclick={editSchedule}>Edit schedule</MenuAction
        >{/if}
      <MenuAction
        icon="list"
        keepOpen={false}
        disabled={!jobs.length}
        onclick={() => (history = true)}>View run history</MenuAction
      >
      <div class="menu-divider" role="separator"></div>
      <MenuAction icon="settings" href="/settings/integrations" keepOpen={false}
        >Manage integration</MenuAction
      >
    </ContextMenu>
  </div>
  <p class="small task-description">{task.description}</p>
  <div class="row small">
    <span class="badge"
      >{task.scope
        ? automatic
          ? 'Automatic'
          : 'Paused'
        : task.id === 'metadata'
          ? 'On demand'
          : 'On changes'}</span
    >
    {#if task.scope}<span>Every {interval} {interval === 1 ? 'minute' : 'minutes'}</span>{/if}
    {#if active.some((job) => job.state === 'running')}<span class="text-accent">Running</span>{/if}
    {#if active.some((job) => job.state === 'failed')}<span class="text-danger"
        >Needs attention</span
      >{/if}
  </div>
  {#if task.scope === 'library'}<p class="small">
      Full scan every {provider.schedule.fullIntervalHours} hours{#if progress?.fullCompletedAt}
        · Last full scan {new Date(progress.fullCompletedAt).toLocaleString()}{/if}
    </p>
  {:else if latest?.updatedAt}<p class="small">
      Last successful run {new Date(latest.updatedAt).toLocaleString()}
    </p>{/if}
  {#if visible.length}<QueueList
      actions={visible.slice(0, 3)}
      compact
    />{:else if task.id !== 'metadata'}<p class="small quiet">
      {filter === 'attention'
        ? 'No runs need attention.'
        : filter === 'finished'
          ? 'No finished runs.'
          : filter === 'all'
            ? 'No recent runs.'
            : 'No active runs.'}
    </p>{/if}
  <div class="row task-controls">
    {#if task.scope}<Button
        variant="ghost"
        icon="clock"
        disabled={busy || !provider.enabled}
        onclick={editSchedule}>Schedule</Button
      >{/if}
    {#if visible.length > 3}<Button variant="ghost" onclick={() => (history = true)}
        >View all {visible.length} runs</Button
      >{/if}
  </div>
  {#if error && !open}<p class="notice error" role="alert">{error}</p>{/if}
</article>
<Dialog bind:open title={`${task.title} schedule · ${provider.name}`}>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <p class="small">
      {automatic ? 'Automatic runs are enabled.' : 'Automatic runs are paused.'} Manage automatic-run
      toggles in <a class="text-accent" href="/settings/integrations">Integrations</a>.
    </p>
    {#if task.interval}<label class="field"
        >{task.scope === 'library'
          ? 'Library changes every (minutes)'
          : task.scope === 'users'
            ? 'User activity every (minutes)'
            : task.scope === 'lists'
              ? 'Lists every (minutes)'
              : task.scope === 'tracking'
                ? 'Tracking every (minutes)'
                : 'Requests every (minutes)'}<input
          type="number"
          min="1"
          max="10080"
          step="1"
          required
          bind:value={draft[task.interval]}
          disabled={busy}
        /></label
      >{/if}
    {#if task.scope === 'library'}
      <label class="field"
        >Full library scan every (hours)<input
          type="number"
          min="1"
          max="720"
          step="1"
          required
          bind:value={draft.fullIntervalHours}
          disabled={busy}
        /></label
      >
      <div class="field">
        <span>Library source account</span><RowFilter
          label="Library source account"
          value={draft.libraryConnectionId ?? 'auto'}
          options={[
            { value: 'auto', label: 'Automatic · first connected account' },
            ...provider.accounts.map((account) => ({ value: account.id, label: account.username })),
          ]}
          onchange={(value) => (draft.libraryConnectionId = value === 'auto' ? null : value)}
        /><small
          >Choose an account that can access every library you want to catalogue. Each user’s access
          is checked separately.</small
        >
      </div>
    {/if}
    <div class="row">
      <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save schedule'}</Button
      ><Button variant="ghost" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
    </div>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  </form>
</Dialog>
<Dialog bind:open={history} title={`${task.title} runs · ${provider.name}`} wide
  ><QueueList
    actions={jobs}
    emptyTitle="No recent runs"
    emptyDescription="Runs for this task appear here when it starts."
  /></Dialog
>

<style>
  .task-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .task-heading {
    gap: 12px;
  }
  .task-controls {
    margin-top: auto;
  }
  .quiet {
    color: var(--muted);
  }
</style>
