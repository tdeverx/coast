<script lang="ts">
  import {page} from '$app/state';
  import RowFeedback from './RowFeedback.svelte';
  import { useClock } from '$lib/ui/clock.svelte';
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
  import { taskJobCount, taskLastRun, lastJobOutcome, jobOutcome, jobRemedy, jobWaiting, jobWaitingReason, jobPurposeLabel, type QueueAction } from '$lib/ui/queue';
  import type { JobTiming } from '$lib/providers/job-timing.server';
  import {displayLabel} from '$lib/ui/labels';
  import {companionHealthy,type CompanionState} from '$lib/providers/jellyfin/companion';
  import {jobIdentityScope} from '$lib/providers/job-policy';

  const { change } = useClient();

  let {
    provider,
    task,
    jobs,
    timing,
    local=false,
    showSource=false,
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
      companion?: unknown;
    };
    task: ServiceTask;
    jobs: QueueAction[];
    timing?: JobTiming;
    local?:boolean;
    showSource?:boolean;
  } = $props();
  const clock = useClock();
  const companion=$derived(provider.companion as CompanionState|undefined);
  const pluginHealthy=$derived(provider.schedule.updatesEnabled&&companionHealthy(companion,clock.now,provider.schedule.updatesIntervalMinutes));
  const countdown = $derived(timing?.nextAt ? Math.max(0, Math.ceil((new Date(timing.nextAt).getTime() - clock.now) / 1000)) : null);
  function durationLabel(seconds: number) { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60 ? `${minutes % 60}m ` : ''}${seconds % 60}s`; }
  async function updateActive(action:'retry'|'cancel'|'promote') {
    if(busy)return;
    busy=true;error='';
    try{
      const result=await change<{updated:number;skipped:number}>(`queue/tasks/${action}`,{kind:task.kinds[0],instanceId:jobs[0]?.instanceId??null});
      notifyAction(`${result.updated} jobs ${action==='retry'?'queued for retry':action==='cancel'?'cancelled':'prioritized'}${result.skipped?` · ${result.skipped} unchanged because the job changed or already has active work`:''}.`);
    }catch(cause){error=message(cause);}finally{busy=false;}
  }
  let open = $state(false),
    busy = $state(false),
    error = $state(''),
    detailsOpen = $state(false);
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
    jobs.filter((job) => ['pending', 'running', 'failed'].includes(job.state) && (job.taskCount ?? 1) > 0)
  );
  const running = $derived(active.find(job => job.state === 'running'));
  const failed = $derived(active.filter(job => job.state === 'failed'));
  const queued = $derived(active.filter(job => job.state === 'pending'));
  const counts = $derived({running:taskJobCount(jobs,'running'),waiting:taskJobCount(jobs,'pending'),failed:taskJobCount(jobs,'failed')});
  const lastRun = $derived(taskLastRun(jobs) ?? timing?.lastRun);
  const status = $derived(active.length
    ? [running ? `${counts.running} running` : null, queued.length ? `${counts.waiting} waiting` : null, failed.length ? `${counts.failed} ${counts.failed === 1 ? 'needs' : 'need'} attention` : null].filter(Boolean).join(' · ')
    : timing?.reason ?? (countdown === 0 ? 'Due now' : countdown !== null ? `Next in ${durationLabel(countdown)}` : task.scope ? 'No automatic run scheduled' : 'On demand'));
  const lastResult = $derived(lastRun ? lastJobOutcome(task.kinds[0], lastRun) ?? displayLabel(lastRun.state) : null);
  const progress = $derived(
    provider.libraryScan as
      { fullCompletedAt?: string; processed?: number; total?: number | null } | undefined
  );
  const fields = $derived(
    task.scope==='streams'?[task.interval??'streamsIntervalMinutes','streamsConnectionId']:task.scope==='live' ? ['liveIdleMinutes','liveActiveMinutes'] : task.scope === 'library'
      ? ['intervalMinutes', 'fullIntervalHours', 'libraryConnectionId']
      : task.interval
        ? [task.interval]
        : []
  );
  function editSchedule() {
    draft = { ...provider.schedule };
    saved = JSON.stringify(draft);
    error = '';
    detailsOpen = false;
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
          : `${result.queued} jobs queued${result.active ? `; ${result.active} existing jobs requested now` : ''}.`
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

<article id={`job-${provider.id}-${task.id}`} class="task-row" aria-label={`${provider.name}: ${task.title}`}>
  <div class="task-summary" use:contextGesture={(point) => menu?.openAt(point)}>
    <div class="task-meta">
      <h3>{task.title}</h3>
      <p class="small">{showSource ? `${provider.name} · ` : ''}{status}{timing && task.scope && !local && jobIdentityScope(task.kinds[0])==='account' ? ` · ${timing.completed ?? 0}/${timing.eligible} users completed · latest runs` : ''}</p>
      {#if lastRun}<p class="small last-result" title={`Last run · ${new Date(lastRun.at).toLocaleString()} · ${lastResult}`}>
        Last: {lastResult} <time datetime={lastRun.at}>{new Date(lastRun.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>
      </p>{/if}
    </div>
    <Button menu bind:this={menu} label={`${provider.name} ${task.title} actions`} disabled={busy}>
      {#if running || queued.length}<Button item icon="clock" keepOpen={false} onclick={()=>void updateActive('promote')}>Prioritize</Button>{/if}
      {#if failed.length && task.kinds[0]!=='benchmark.run'}<Button item icon="refresh" keepOpen={false} onclick={()=>void updateActive('retry')}>Retry failures</Button>{/if}
      {#if task.kinds[0]==='benchmark.run'}<Button item icon="refresh" href="/settings/benchmarks" keepOpen={false}>Run a new benchmark</Button>{/if}
      {#if queued.length || failed.length}<Button item icon="close" danger keepOpen={false} onclick={()=>void updateActive('cancel')}>Cancel waiting work</Button>{/if}
      {#if task.scope}
        <Button item icon="refresh" keepOpen={false}
          disabled={!provider.enabled || (!provider.connectedAccounts && !local && !['tmdb','igdb'].includes(provider.provider))}
          disabledReason={!provider.enabled ? 'Enable this service in Integrations.' : 'Connect an account before running this task.'}
          onclick={() => void run()}>Run now</Button>
        <Button item icon="clock" keepOpen={false} disabled={!provider.enabled} onclick={editSchedule}>Edit schedule</Button>
      {/if}
      <Button item icon="list" keepOpen={false} onclick={()=>detailsOpen=true}>Details</Button>
      {#if !local}<div class="menu-divider" role="separator"></div><Button item icon="settings" href="/settings/integrations" keepOpen={false}>Manage integration</Button>{/if}
    </Button>
  </div>
  {#if error && !open && !detailsOpen}<RowFeedback error={error} tag="p" class="notice error" />{/if}
</article>
<Dialog bind:open={detailsOpen} title={`${task.title} · ${provider.name}`}>
  {#if detailsOpen}<div class="stack task-details">
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
  {#if provider.provider==='jellyfin'&&task.kinds[0]==='jellyfin.updates'}<p class="small">{pluginHealthy?'Caught up · Native live polling is replaced; full reconciliation remains.':companion?.reason??(companion?.status==='reconciling'?'Reconciling after a feed reset or incomplete updates · Native polling remains.':'Plugin not detected yet · Native polling remains.')}</p>{/if}
  {#if provider.provider==='jellyfin'&&['jellyfin.sync','jellyfin.library'].includes(task.kinds[0])&&pluginHealthy}<p class="small">Plugin changes between full reconciliations every {provider.schedule.fullIntervalHours} hours. The minute interval is the polling fallback.</p>{/if}
  {#if task.scope === 'library'}<p class="small">
      Full scan every {provider.schedule.fullIntervalHours} hours{#if progress?.fullCompletedAt}
        · Last full scan {new Date(progress.fullCompletedAt).toLocaleString()}{/if}
    </p>
{/if}
  {#if running}
    <p class="small" role="status">{['Running', jobPurposeLabel(running)].filter(Boolean).join(' · ')}</p>
    {#if jobOutcome(running)}<p class="small">{jobOutcome(running)}</p>{/if}
  {:else if queued.length}
    <p class="small" role="status">{[jobWaitingReason(queued[0]), jobPurposeLabel(queued[0]), queued[0].waitingReason === 'yielded' ? jobOutcome(queued[0]) : null].filter(Boolean).join(' · ')}</p>
    {#if jobWaiting(queued[0])}<p class="small">Next attempt · {new Date(queued[0].nextAttemptAt!).toLocaleString()}</p>{/if}
  {:else if task.scope}
    <p class="small" role="status">{timing?.reason ?? (countdown === 0 ? 'Due now · checked within one minute' : countdown !== null ? `Next run in ${durationLabel(countdown)}` : 'Schedule assessment unavailable')}</p>
    {#if timing?.nextAt && countdown !== null && countdown > 0}<p class="small">Next eligible {task.scope === 'metadata' ? 'batch' : 'account'} · {new Date(timing.nextAt).toLocaleString()}</p>{/if}
  {:else}<p class="small">{task.id === 'metadata' ? 'Fetched when requested.' : 'Runs when a change needs delivery.'}</p>{/if}
  {#if lastRun}<p class="small">Last run · {new Date(lastRun.at).toLocaleString()} · {displayLabel(lastRun.state)}</p>
    {#if lastJobOutcome(task.kinds[0],lastRun)}<p class="small">{lastJobOutcome(task.kinds[0],lastRun)}</p>{/if}
  {/if}
  {#if timing?.lastAt && timing.lastAt !== lastRun?.at}<p class="small">Freshness · Last successful {local || provider.provider === 'tmdb' ? 'batch' : 'account'} {new Date(timing.lastAt).toLocaleString()}</p>{/if}
  {#if timing && task.scope && !local && jobIdentityScope(task.kinds[0])==='account'}<p class="small">{timing.fresh}/{timing.eligible} users fresh · Within two schedule intervals</p>{/if}
  {#if active.length}<p class="small">{[counts.running?`${counts.running} running`:null,counts.waiting?`${counts.waiting} waiting`:null,counts.failed?`${counts.failed} ${counts.failed === 1 ? 'needs' : 'need'} attention`:null].filter(Boolean).join(' · ')}</p>{/if}
  {#if timing?.reviews}<p class="small">{timing.reviews} titles need tracking review · Each owner can review them in <a href="/settings/pending" class="text-accent">Sync conflicts</a>.</p>{/if}
  {#if failed.length}
    <p class="small">{failed[0].lastError || 'Review diagnostics for the failure reason.'}</p>
    {#if failed.some(job=>jobRemedy(job)==='connection')}<a href="/settings/connections" class="text-accent">Reconnect accounts</a>{/if}
    {#if failed.some(job=>jobRemedy(job)==='permissions')}<a href="/settings/integrations" class="text-accent">Review permissions</a>{/if}
    {#if failed.some(job=>jobRemedy(job)==='metadata')}<a href="/settings/activity" class="text-accent">Review diagnostics</a>{/if}
  {/if}
  <div class="row task-controls">
    {#if failed.length && task.kinds[0]!=='benchmark.run'}<Button emphasis="subtle" icon="refresh" disabled={busy} onclick={()=>void updateActive('retry')}>Retry</Button>{/if}
    {#if task.scope}<Button  icon="refresh" disabled={busy || !provider.enabled || (!provider.connectedAccounts && !local && !['tmdb','igdb'].includes(provider.provider))} onclick={() => void run()}>Run now</Button>
      <Button emphasis="subtle" icon="clock" disabled={busy || !provider.enabled} onclick={editSchedule}>Edit schedule</Button>{/if}
  </div>
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
  </div>{/if}
</Dialog>
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
            : task.scope==='streams'?(task.kinds[0]==='jellyfin.updates'?'Check plugin updates every (minutes)':'Server streams every (minutes)'):task.scope === 'live' ? 'Idle checks every (minutes)' : task.scope === 'lists'
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
    {#if task.scope==='streams'}<div class="field"><span>Server administrator account</span><RowFilter selection groups={[{label:'Administrator account',value:draft.streamsConnectionId??'auto',options:[{value:'auto',label:'Automatic · first connected administrator'},...provider.accounts.filter(account=>account.role==='admin').map(account=>({value:account.id,label:account.username}))],change:value=>(draft.streamsConnectionId=value==='auto'?null:value)}]}/><small>This account must also be a Jellyfin administrator.</small></div>{/if}
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

<style>
  .task-row {scroll-margin-top:88px;min-width:0;padding:16px 0;border-bottom:1px solid var(--line);}
  .task-summary {display:flex;align-items:center;gap:12px;}
  .task-meta {flex:1;min-width:0;}
  h3 {font-size:var(--text-sm);font-weight:var(--weight-semibold);margin:0;}
  .task-meta p {margin:4px 0 0;}
  .last-result {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  time {margin-left:8px;}
  .task-details {gap:12px;overflow-wrap:anywhere;}
</style>
