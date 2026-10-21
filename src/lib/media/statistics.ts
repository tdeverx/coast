import type { ActivityDay } from '#lib/profile/activity.js';
export interface MediaStatistics {
  days: ActivityDay[];
  today: string;
  watches: number;
  unique: number;
  undated: number;
  first: string | null;
  last: string | null;
}
