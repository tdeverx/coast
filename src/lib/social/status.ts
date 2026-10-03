export const statusPreferences = ['automatic', 'away', 'busy', 'invisible'] as const;
export type StatusPreference = typeof statusPreferences[number];
export type ActivityStatus = 'online' | 'away' | 'busy' | 'offline';
export const statusLabels = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' } as const;
export const preferenceLabels = { automatic: 'Online', away: 'Away', busy: 'Busy', invisible: 'Invisible' } as const;
export const IDLE_MS = 5 * 60_000;
export const OFFLINE_MS = 90_000;
export function activityStatus(preference: StatusPreference, heartbeatAt: number | null, activeAt: number | null, now: number): ActivityStatus {
  if (preference === 'invisible' || heartbeatAt === null || now - heartbeatAt >= OFFLINE_MS) return 'offline';
  if (preference !== 'automatic') return preference;
  return activeAt !== null && now - activeAt < IDLE_MS ? 'online' : 'away';
}
