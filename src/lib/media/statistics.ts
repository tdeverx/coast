import type { ActivityDay } from '$lib/profile/activity';
export interface MediaStatistics {
  days: ActivityDay[];
  today: string;
  watches: number;
  unique: number;
  undated: number;
  first: string | null;
  last: string | null;
}
