export type QueueAction = {
    id: string;
    kind: string;
    state: string;
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
    progress?: { processed?: number; total?: number | null; phase?: string; failed?: number } | null;
  };

export const jobWaiting = (action: QueueAction) => !!(action.state === 'pending' && action.nextAttemptAt && new Date(action.nextAttemptAt).getTime() > Date.now());

export const jobServiceWaiting = (action: QueueAction) => !!(action.state === 'pending' && action.serviceRetryAt && new Date(action.serviceRetryAt).getTime() > Date.now());

export function jobOutcome(action: QueueAction) {
  if(action.kind==='taste.refresh'&&action.state==='succeeded'&&action.outcome)return `${action.outcome.refreshed??0} user taste profiles refreshed${action.outcome.deferred?` · ${action.outcome.deferred} changed during calculation; retry next run`:''}`;
  if(action.kind.endsWith('.recommendations')&&action.outcome)return `${action.outcome.added??0} suggestions cached from ${action.outcome.checked??0} ${action.kind.startsWith('trakt.')?'recommendation lists':'titles'}`;
  const progress = action.progress;
  if (action.state === 'running' && progress) return `${progress.processed ?? 0} items checked${progress.total == null ? '' : ` of ${progress.total}`}`;
  if (action.state !== 'succeeded') return null;
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
