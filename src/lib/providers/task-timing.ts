import {companionHealthy,type CompanionState} from './jellyfin/companion';
import type { ProviderSchedule } from './schedule';
import type { ServiceTask } from './tasks';

export type TaskSettings = {
  schedule?: unknown;
  companion?: CompanionState;
  libraryScan?: { connectionId?: string; externalUserId?: string | null; fullCompletedAt?: string; recentCompletedAt?: string };
  sync?: Record<string, boolean>;
  liveRead?: boolean;
  collectionProjection?: { enabled?: boolean };
  importAchievements?: boolean;
  requestsVerifiedAt?: string;
};
export type TaskAccount = { id: string; externalUserId: string | null; role: string; settings: TaskSettings; live?: boolean; configured?: boolean; userCompleted?: Date | null };
export type TaskEvidence = { completed?: Date | string | null; blocked?: boolean };
export type TaskFeatures = { enableTrakt: boolean; enableRequests: boolean; experimentalGaming: boolean; developerMode: boolean };

/** Bootstrap is requested by connection/onboarding, never by a recurring timer. */
export const recurringTask = (kind: string) => kind !== 'jellyfin.bootstrap';
export function taskSchedulingEnabled(provider: string, enabled: boolean, task: ServiceTask, schedule: ProviderSchedule, features: TaskFeatures, force = false) {
  return enabled && (provider !== 'trakt' || features.enableTrakt) && (provider !== 'seerr' || features.enableRequests) && (!['steam', 'igdb'].includes(provider) || features.experimentalGaming)
    && (force || !features.developerMode && schedule.enabled && (!task.enabled || !!schedule[task.enabled]));
}

/** Account opt-ins and selected shared sources apply to automatic and manual runs. */
export function eligibleTaskAccounts<T extends TaskAccount>(kind: string, accounts: T[], schedule: ProviderSchedule, settings: TaskSettings, hasTmdb: boolean): T[] {
  let eligible = accounts.filter(account => {
    if (kind === 'trakt.recommendations') return account.configured !== false;
    if (kind === 'jellyfin.streams' || kind === 'jellyfin.updates') return account.role === 'admin';
    if (kind === 'catalogue.user-scan') return hasTmdb;
    if (kind === 'steam.achievements') return account.settings.importAchievements !== false;
    if (kind.endsWith('.live')) return account.settings.liveRead !== false;
    if (kind === 'trakt.collection-project') return account.settings.collectionProjection?.enabled === true;
    if (kind === 'trakt.lists-import') return account.settings.sync?.lists === true;
    if (kind === 'trakt.import') return ['history', 'progress', 'collection', 'ratings', 'watchlist'].some(category => account.settings.sync?.[category]);
    return true;
  });
  if (kind === 'jellyfin.library') {
    const selected = schedule.libraryConnectionId ?? settings.libraryScan?.connectionId;
    const source = eligible.find(account => account.id === selected) ?? (schedule.libraryConnectionId ? undefined : eligible[0]);
    eligible = source ? [source] : [];
  }
  if (kind === 'jellyfin.streams' || kind === 'jellyfin.updates') {
    const source = schedule.streamsConnectionId ? eligible.find(account => account.id === schedule.streamsConnectionId) : eligible[0];
    eligible = source ? [source] : [];
  }
  return eligible;
}

const timestamp = (value: Date | string | null | undefined) => value ? new Date(value).getTime() || 0 : 0;
export function taskCompletedAt(kind: string, account: TaskAccount, evidence: TaskEvidence): number {
  if (kind === 'jellyfin.sync') return timestamp(account.userCompleted);
  if (kind === 'seerr.sync') return timestamp(account.settings.requestsVerifiedAt);
  return timestamp(evidence.completed);
}
export function taskIntervalMs(task: ServiceTask, schedule: ProviderSchedule, account: TaskAccount): number {
  if (task.kinds[0]?.endsWith('.live')) return (account.live ? schedule.liveActiveMinutes : schedule.liveIdleMinutes) * 60000;
  return Number(task.interval ? schedule[task.interval] : 0) * 60000;
}

/** Pure due evidence shared by the timer and Jobs; execution/retry gates remain in the queue. */
export function taskDue(task: ServiceTask, schedule: ProviderSchedule, settings: TaskSettings, account: TaskAccount, evidence: TaskEvidence, now: number, force = false): { at: number | null; completed: number; interval: number; full?: boolean } {
  const kind = task.kinds[0];
  const completed = taskCompletedAt(kind, account, evidence);
  let interval = taskIntervalMs(task, schedule, account);
  const bridge=settings.companion;
  const healthy=schedule.updatesEnabled&&companionHealthy(bridge,now,schedule.updatesIntervalMinutes)
    &&(!schedule.streamsConnectionId||schedule.streamsConnectionId===bridge?.connectionId);
  if(!force&&healthy&&['jellyfin.live','jellyfin.streams'].includes(kind))return {at:null,completed,interval};
  if(healthy&&kind==='jellyfin.sync')interval=Math.max(interval,schedule.fullIntervalHours*3600000);
  if(kind==='jellyfin.updates'&&bridge?.status==='unavailable')interval=Math.max(interval,10*60000);
  if (kind === 'jellyfin.library') {
    const library = settings.libraryScan ?? {};
    const fullAt = timestamp(library.fullCompletedAt), recentAt = timestamp(library.recentCompletedAt);
    const changedSource = library.connectionId !== account.id || library.externalUserId !== account.externalUserId;
    const full = force || changedSource || !fullAt || now >= fullAt + schedule.fullIntervalHours * 3600000;
    return { at: evidence.blocked ? null : force || changedSource || !fullAt ? now : Math.min(fullAt + schedule.fullIntervalHours * 3600000, Math.max(fullAt, recentAt) + (healthy?schedule.fullIntervalHours*3600000:interval)), completed: Math.max(fullAt, recentAt), interval, full };
  }
  return { at: evidence.blocked || !force && !recurringTask(kind) ? null : force || !completed ? now : completed + interval, completed, interval };
}
