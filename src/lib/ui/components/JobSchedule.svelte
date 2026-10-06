<script lang="ts">
  import {page} from '$app/state';
  import RowFeedback from './RowFeedback.svelte';
  import { useClock } from '$lib/ui/clock.svelte';
  import { createQueueActions } from '$lib/ui/controls/queue.svelte';
  import Heading from './Heading.svelte';
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import { contextGesture } from '$lib/ui/context-gesture';
  import type { ServiceTask } from '$lib/providers/tasks';
  import type { ProviderSchedule } from '$lib/providers/schedule';
  import Button from './Button.svelte';

  import Dialog from './Dialog.svelte';
  import RowFilter from './RowFilter.svelte';
  import QueueList from './QueueList.svelte';
  import { jobOutcome, jobRemedy, jobWaiting, jobServiceWaiting, type QueueAction } from '$lib/ui/queue';
  import type { JobTiming } from '$lib/providers/job-timing.server';

  const { change } = useClient();
  const queue = createQueueActions();

  let {
    provider,
    task,
    jobs,
    timing,
    local=false,
  }: {
    provider: {
      id: string;
      name: string;
      provider: string;
      enabled: boolean;
      connectedAccounts: number;
      accounts: { id: string; username: string; role?:string }[];
      schedule: ProviderSchedule;
      libraryScan?: unknown;
    };
    task: ServiceTask;
    jobs: QueueAction[];
    timing?: JobTiming;
    local?:boolean;
  } = $props();
  const clock = useClock();
  const countdown = $derived(timing?.nextAt ? Math.max(0, Math.ceil((new Date(timing.nextAt).getTime() - clock.now) / 1000)) : null);
  function durationLabel(seconds: number) { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60 ? `${minutes % 60}m ` : ''}${seconds % 60}s`; }
  async function retry(id: string) {
    if (busy) return;
    busy = true;
    try { await queue.run(id, 'retry'); error = queue.error; }
    finally { busy = false; }
  }
  let open = $state(false),
    history = $state(false),
    busy = $state(false),
    error = $state('');
  let draft = $state<ProviderSchedule>(untrack(() => ({ ...provider.schedule })));
  let saved = $state('');
  let menu = $state<Button>();
  const dirty = $derived(open && JSON.stringify(draft) !== saved);
  const automatic = $derived(
    !page.data.developerMode &&
    provider.enabled &&
      provider.schedule.enabled &&
      (!task.enabled || !!provider.schedule[task.enabled])
  );
  const interval = $derived(task.interval ? provider.schedule[task.interval] : 0);
  const active = $derived(
    jobs.filter((job) => ['pending', 'running', 'failed'].includes(job.state))
  );
  const running = $derived(active.find(job => job.state === 'running'));
  const failed = $derived(active.filter(job => job.state === 'failed'));
  const queued = $derived(active.filter(job => job.state === 'pending'));
  const latest = $derived(jobs.find((job) => job.state === 'succeeded'));
  const progress = $derived(
    provider.libraryScan as
      { fullCompletedAt?: string; processed?: number; total?: number | null } | undefined
  );
  const fields = $derived(
    task.scope==='streams'?['streamsIntervalMinutes','streamsConnectionId']:task.scope==='live' ? ['liveIdleMinutes','liveActiveMinutes'] : task.scope === 'library'
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
        local?'admin/taste-schedule':`providers/${provider.id}/schedule`,
        {...Object.fromEntries(fields.map((field) => [field, draft[field as keyof ProviderSchedule]])),...(local?{enabled:draft.enabled}:{})}
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
        local?'admin/taste-refresh':`providers/${provider.id}/run-job`,
        { task: task.scope, kind: task.kinds[0] }
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

<article id={`job-${provider.id}-${task.id}`} class="panel task-card" aria-label={`${provider.name}: ${task.title}`}>
  <div class="spread task-heading" use:contextGesture={(point) => menu?.openAt(point)}>
    <Heading variant="title" title={task.title} />
    <Button menu bind:this={menu} label={`${provider.name} ${task.title} actions`}>
      {#if task.scope}<Button item
          icon="refresh"
          keepOpen={false}
          disabled={busy || !provider.enabled || (!provider.connectedAccounts && !local && !['tmdb','igdb'].includes(provider.provider))}
          disabledReason={!provider.enabled
            ? 'Enable this service in Integrations.'
            : (!provider.connectedAccounts && !local && !['tmdb','igdb'].includes(provider.provider))
              ? 'Connect an account before running this task.'
              : undefined}
          onclick={() => void run()}>Run now</Button>
        <Button item
          icon="clock"
          keepOpen={false}
          disabled={busy || !provider.enabled}
          onclick={editSchedule}>Edit schedule</Button>{/if}
      <Button item
        icon="list"
        keepOpen={false}
        disabled={!jobs.length}
        onclick={() => (history = true)}>View run history</Button>
      <div class="menu-divider" role="separator"></div>
      {#if !local}<Button item icon="settings" href="/settings/integrations" keepOpen={false}
        >Manage integration</Button>{/if}
    </Button>
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
    {#if task.scope}<span>{!local && task.scope === 'metadata' && task.interval!=='recommendationsIntervalMinutes' ? 'Each title every' : 'Every'} {interval} {interval === 1 ? 'minute' : 'minutes'}{task.scope === 'live' ? ` idle · Every ${provider.schedule.liveActiveMinutes} ${provider.schedule.liveActiveMinutes === 1 ? 'minute' : 'minutes'} active` : ''}</span>{/if}
    {#if active.some((job) => job.state === 'running')}<span class="text-accent">Running</span>{/if}
    {#if active.some((job) => job.state === 'failed')}<span class="text-danger"
        >Needs attention</span
      >{/if}
  </div>
  {#if task.scope === 'library'}<p class="small">
      Full scan every {provider.schedule.fullIntervalHours} hours{#if progress?.fullCompletedAt}
        · Last full scan {new Date(progress.fullCompletedAt).toLocaleString()}{/if}
    </p>
{/if}
  {#if running}
    <p class="small" role="status">Running{#if running.connectionLabel} · {running.connectionLabel}{/if}</p>
    {#if jobOutcome(running)}<p class="small">{jobOutcome(running)}</p>{/if}
  {:else if queued.length}
    <p class="small" role="status">{page.data.developerMode ? 'Developer mode · Run now to start queued work' : queued.some(jobServiceWaiting) ? 'Waiting for service cooldown' : queued.some(jobWaiting) ? 'Waiting to retry' : 'Queued · waiting for the current job to finish'}</p>
    {#each queued.filter(jobWaiting) as job (job.id)}<p class="small">{job.connectionLabel} · Retry {new Date(job.nextAttemptAt!).toLocaleString()}</p>{/each}
  {:else if task.scope}
    <p class="small" role="status">{timing?.reason ?? (countdown === 0 ? 'Due now · checked within one minute' : countdown !== null ? `Next run in ${durationLabel(countdown)}` : 'Schedule assessment unavailable')}</p>
    {#if timing?.nextAt && countdown !== null && countdown > 0}<p class="small">Next eligible {task.scope === 'metadata' ? 'batch' : 'account'} · {new Date(timing.nextAt).toLocaleString()}</p>{/if}
  {:else}<p class="small">{task.id === 'metadata' ? 'Fetched when requested.' : 'Runs when a change needs delivery.'}</p>{/if}
  {#if latest}<p class="small">{jobOutcome(latest)}</p>{/if}
  {#if timing?.lastAt}<p class="small">Freshness · Last successful {local || provider.provider === 'tmdb' ? 'batch' : 'account'} {new Date(timing.lastAt).toLocaleString()}</p>{/if}
  {#if timing && !local && !['tmdb','igdb'].includes(provider.provider) && timing.eligible}<p class="small">{timing.fresh} of {timing.eligible} eligible accounts current · Within two schedule intervals</p>{/if}
  {#if timing?.reviews}<p class="small">{timing.reviews} titles need tracking review · Each owner can review them in <a href="/settings/pending" class="text-accent">Sync conflicts</a>.</p>{/if}
  {#each failed as job (job.id)}
    <div class="stack small">
      <p>{job.connectionLabel} · {job.lastError || 'The failure reason was not retained. Review diagnostics.'}</p>
      {#if jobRemedy(job) === 'connection'}<a href="/settings/connections" class="text-accent">Reconnect account</a>
      {:else if jobRemedy(job) === 'permissions'}<a href="/settings/integrations" class="text-accent">Review service permissions</a>
      {:else if jobRemedy(job) === 'metadata'}<a href="/settings/activity" class="text-accent">Review metadata diagnostics</a>
      {:else}<Button emphasis="subtle" disabled={busy || running != null || queued.length > 0} onclick={() => retry(job.id)}>Retry {job.connectionLabel}</Button>{/if}
    </div>
  {/each}
  <div class="row task-controls">
    {#if task.scope}<Button  icon="refresh" disabled={busy || !provider.enabled || running != null || queued.length > 0 || (!provider.connectedAccounts && !local && !['tmdb','igdb'].includes(provider.provider))} onclick={() => void run()}>Run now</Button>
      <Button emphasis="subtle" icon="clock" disabled={busy || !provider.enabled} onclick={editSchedule}>Edit schedule</Button>{/if}
    {#if jobs.length}<Button emphasis="subtle" onclick={() => history = true}>Run history</Button>{/if}
  </div>
  {#if error && !open}<RowFeedback error={error} tag="p" class="notice error" />{/if}
</article>
<Dialog bind:open title={`${task.title} schedule · ${provider.name}`}>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    {#if local}<label class="check"><input type="checkbox" bind:checked={draft.enabled} disabled={busy}/>Automatic runs</label>{:else}<p class="small">
      {automatic ? 'Automatic runs are enabled.' : 'Automatic runs are paused.'} Manage automatic-run
      toggles in <a class="text-accent" href="/settings/integrations">Integrations</a>.
    </p>{/if}
    {#if task.interval}<label class="field"
        >{local?'Refresh taste profiles every (minutes)':task.interval==='recommendationsIntervalMinutes' ? 'Refresh recommendations every (minutes)' : task.scope === 'library'
          ? 'Library changes every (minutes)'
          : task.scope === 'users'
            ? 'User activity every (minutes)'
            : task.scope==='streams'?'Server streams every (minutes)':task.scope === 'live' ? 'Idle checks every (minutes)' : task.scope === 'lists'
              ? 'Lists every (minutes)'
              : task.scope === 'tracking'
                ? 'Tracking every (minutes)'
                : task.scope === 'catalogue' ? 'User catalogue every (minutes)' : task.scope === 'metadata' ? 'Refresh each title every (minutes)' : 'Requests every (minutes)'}<input
          type="number"
          min="1"
          max="10080"
          step="1"
          required
          bind:value={draft[task.interval]}
          disabled={busy}
        /></label
      >{/if}
    {#if task.scope==='streams'}<div class="field"><span>Server streams source account</span><RowFilter selection groups={[{label:'Administrator account',value:draft.streamsConnectionId??'auto',options:[{value:'auto',label:'Automatic · first connected administrator'},...provider.accounts.filter(account=>account.role==='admin').map(account=>({value:account.id,label:account.username}))],change:value=>(draft.streamsConnectionId=value==='auto'?null:value)}]}/><small>This account must also be a Jellyfin administrator.</small></div>{/if}
    {#if task.scope==='live'}<label class="field">Active checks every (minutes)<input type="number" min="1" max="10080" step="1" required bind:value={draft.liveActiveMinutes} disabled={busy} /></label>{/if}
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
        <span>Library source account</span><RowFilter selection groups={[{label:"Library source account", value:draft.libraryConnectionId ?? 'auto', options:[
            { value: 'auto', label: 'Automatic · first connected account' },
            ...provider.accounts.map((account) => ({ value: account.id, label: account.username })),
          ], change:(value) => (draft.libraryConnectionId = value === 'auto' ? null : value)}]} /><small
          >Choose an account that can access every library you want to catalogue. Each user’s access
          is checked separately.</small
        >
      </div>
    {/if}
    <div class="row">
      <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save schedule'}</Button
      ><Button emphasis="subtle" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
    </div>
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
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
    scroll-margin-top:88px;
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
</style>
