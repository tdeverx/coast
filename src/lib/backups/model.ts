export type BackupPolicy = {
  enabled: boolean;
  time: string;
  timeZone: string;
  keep: number;
  recipient: string;
};

export const defaultBackupPolicy: BackupPolicy = {
  enabled: false,
  time: '03:30',
  timeZone: 'UTC',
  keep: 14,
  recipient: '',
};

export type BackupSnapshot = {
  name: string;
  completedAt: string;
  bytes: number;
};

export type BackupStatus = {
  available: boolean;
  policy: BackupPolicy;
  state: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  attemptedAt: string | null;
  error: string | null;
  latest: BackupSnapshot | null;
};

/** Calendar days in the selected zone, including days with a daylight saving change. */
export function dueBackupDay(policy: BackupPolicy, now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: policy.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  if (`${part('hour')}:${part('minute')}` < policy.time) return null;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
