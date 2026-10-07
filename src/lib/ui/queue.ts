import type { JobPurpose } from '$lib/providers/job-policy';
import { jellyfinImportStage, type JellyfinScanProgress } from '$lib/sync/jellyfin-progress';

export type QueueAction = {
    id: string;
    taskCount?: number;
    kind: string;
    state: string;
    purpose?: JobPurpose | null;
    waitingReason?: string | null;
    attempts: number;
    lastError: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    nextAttemptAt?: Date | string;
    serviceRetryAt?: Date | string | null;
    connectionLabel?: string;
    instanceId?: string | null;
    failure?: { code: string; remedy: 'connection' | 'permissions' | 'metadata' | 'retry'; retryable: boolean } | null;
    outcome?: { checked?: number; added?: number; refreshed?: number; deferred?: number } | null;
    progress?: { processed?: number; total?: number | null; phase?: string; failed?: number; stageProcessed?: number; stageTotal?: number | null } | null;
  };

export const jobWaiting = (action: QueueAction) => !!(action.state === 'pending' && action.nextAttemptAt && new Date(action.nextAttemptAt).getTime() > Date.now());

export const jobServiceWaiting = (action: QueueAction) => !!(action.state === 'pending' && action.serviceRetryAt && new Date(action.serviceRetryAt).getTime() > Date.now());

export function jobWaitingReason(action: QueueAction) {
  if (action.state !== 'pending') return null;
  const labels: Record<string, string> = {
    'service-cooldown': 'Waiting for service cooldown',
    'retry-backoff': 'Waiting to retry',
    paused: 'Developer mode · Run now to start queued work',
    'connection-attention': 'Waiting for connection attention',
    'account-order': 'Waiting for an earlier account job',
    'provider-capacity': 'Waiting for the current service scan',
    yielded: 'Import paused between pages · Waiting to continue',
    'worker-capacity': 'Queued · Waiting for other jobs',
  };
  return action.waitingReason && labels[action.waitingReason] || (jobServiceWaiting(action) ? labels['service-cooldown'] : jobWaiting(action) ? labels['retry-backoff'] : 'Queued');
}
export function jobPurposeLabel(action: QueueAction) {
  return action.purpose ? { playback: 'Playback', interactive: 'Your action', bootstrap: 'Account setup', manual: 'Requested now', live: 'Live activity', scheduled: 'Scheduled' }[action.purpose] : null;
}

export function jobOutcome(action: QueueAction) {
  if(action.kind==='jellyfin.streams'&&action.outcome?.checked!=null)return `${action.outcome.checked} active streams`;
  if(action.kind==='taste.refresh'&&action.state==='succeeded'&&action.outcome)return `${action.outcome.refreshed??0} user taste profiles refreshed${action.outcome.deferred?` · ${action.outcome.deferred} changed during calculation; retry next run`:''}`;
  if(action.kind.endsWith('.recommendations')&&action.outcome)return `${action.outcome.added??0} suggestions cached from ${action.outcome.checked??0} ${action.kind.startsWith('trakt.')?'recommendation lists':'titles'}`;
  const progress = action.progress;
  if (['running', 'pending'].includes(action.state) && progress && ['jellyfin.bootstrap', 'jellyfin.sync', 'jellyfin.library'].includes(action.kind)) {
    const stage = action.kind === 'jellyfin.library' && progress.phase === 'scanning' ? 'Scanning shared library metadata'
      : jellyfinImportStage(progress.phase as JellyfinScanProgress['phase']);
    if (stage) {
      const processed = progress.stageProcessed ?? progress.processed ?? 0;
      const total = progress.stageTotal === undefined ? progress.total : progress.stageTotal;
      return `${stage} · ${processed}${total == null ? '' : ` of ${total}`}`;
    }
  }
  if (['running','pending'].includes(action.state) && progress) {
    const labels: Record<string,string> = {'owned-games':'Importing owned games','achievements':'Checking achievements'};
    let stage=progress.phase ? labels[progress.phase] : undefined;
    if(progress.phase?.startsWith('trakt-')) {
      const category=progress.phase.split('-')[1], phase=progress.phase.split('-')[2];
      const names: Record<string,string>={history:'history',progress:'resume positions',ratings:'ratings',watchlist:'watchlist',collection:'Collection',lists:'lists',list:'list members'};
      if(names[category])stage=`${phase==='fetching'?'Reading':phase==='cleaning'?'Checking removals for':'Importing'} ${names[category]}`;
    }
    if(stage)return `${stage} · ${progress.processed??0}${progress.total==null?'':` of ${progress.total}`}`;
  }
  if (action.state === 'running' && progress) return `${progress.processed ?? 0} items checked${progress.total == null ? '' : ` of ${progress.total}`}`;
  if (action.state !== 'succeeded') return null;
  if (['jellyfin.bootstrap', 'jellyfin.sync', 'jellyfin.library'].includes(action.kind)) {
    const checked = action.outcome?.checked ?? progress?.processed;
    const count = checked == null ? '' : ` · ${checked} screen items checked`;
    if (action.kind === 'jellyfin.bootstrap') return `Personal activity imported${count} · Full library access checked separately`;
    if (action.kind === 'jellyfin.sync') return `Full library access and personal activity checked${count}`;
    return `Shared library metadata checked${count}`;
  }
  if(action.kind==='jellyfin.updates')return action.outcome?.deferred?'Plugin unavailable · Native polling retained':`${action.outcome?.checked??0} change hints queued · Current streams checked`;
  if(action.kind==='jellyfin.delta')return `${action.outcome?.checked??0} changed items checked`;
  if (action.kind.startsWith('steam.') && action.outcome?.checked != null) return `${action.outcome.checked} games checked${action.outcome.added ? ` · Added ${action.outcome.added} to Collection` : ''}${action.outcome.deferred ? ` · ${action.outcome.deferred} ${action.kind === 'steam.achievements' ? 'achievement reads' : 'metadata matches'} deferred` : ''}`;
  if (action.outcome?.checked != null) return `${action.outcome.checked} items checked`;
  if (action.outcome?.added != null) return action.outcome.added ? `Added ${action.outcome.added} titles` : 'Nothing new to add';
  if (action.outcome?.refreshed != null) return `${action.outcome.refreshed ? `Refreshed ${action.outcome.refreshed} titles` : 'No titles due for refresh'}${action.outcome.deferred ? ` · ${action.outcome.deferred} metadata records deferred` : ''}`;
  if (action.kind === 'tmdb.refresh' && progress) return `${Math.max(0, (progress.processed ?? 0) - (progress.failed ?? 0))} titles refreshed${progress.failed ? ` · ${progress.failed} metadata records deferred for retry` : ''}`;
  if (progress) return `${progress.processed ?? 0} items checked`;
  return 'Completed successfully';
}
export function jobRemedy(action: QueueAction) {
  if (action.failure) return action.failure.remedy;
  if (action.lastError?.includes('Authentication failed')) return 'connection';
  if (action.lastError?.includes('Access denied')) return 'permissions';
  if (action.lastError?.includes('metadata identities')) return 'metadata';
  return 'retry';
}

/** Scheduled task cards are not additional jobs. A queued/running/failed run
 * already represents the task; finished runs do not suppress its next run. */
export function jobTaskSections<T extends {jobs:QueueAction[];timing?:{nextAt:string|null}}>(entries:T[]) {
  const active=(entry:T,state:string)=>taskJobCount(entry.jobs,state)>0;
  const running=entries.filter(entry=>active(entry,'running'));
  const waiting=entries.filter(entry=>!active(entry,'running')&&active(entry,'pending'));
  const attention=entries.filter(entry=>!active(entry,'running')&&!active(entry,'pending')&&active(entry,'failed'));
  const available=entries.filter(entry=>!['pending','running','failed'].some(state=>taskJobCount(entry.jobs,state)>0));
  const next=(entry:T)=>entry.timing?.nextAt?new Date(entry.timing.nextAt).getTime():NaN;
  return {
    running,waiting,attention,
    upcoming:available.filter(entry=>Number.isFinite(next(entry))).sort((a,b)=>next(a)-next(b)),
    manual:available.filter(entry=>!Number.isFinite(next(entry))),
  };
}

export function lastJobOutcome(kind:string,run:import('$lib/providers/job-timing.server').LastJobRun) {
  return run.lastError??jobOutcome({id:run.id,kind,state:run.state,attempts:0,lastError:null,outcome:run.outcome})??(run.state==='cancelled'?'Cancelled':null);
}

/** Representatives carry database totals; ordinary queue rows count as one. */
export function taskJobCount(jobs:QueueAction[],state:string) {
  return jobs.filter(job=>job.state===state).reduce((total,job)=>total+(job.taskCount??1),0);
}
export function taskLastRun(jobs:QueueAction[]):import('$lib/providers/job-timing.server').LastJobRun|null {
  const run=jobs.filter(job=>['succeeded','failed','cancelled'].includes(job.state)&&job.updatedAt)
    .sort((a,b)=>new Date(b.updatedAt!).getTime()-new Date(a.updatedAt!).getTime())[0];
  return run?{id:run.id,state:run.state as 'succeeded'|'failed'|'cancelled',at:new Date(run.updatedAt!).toISOString(),outcome:run.outcome??null,lastError:run.lastError}:null;
}
