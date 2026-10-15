import type { GameStatus } from '$lib/games/model';
import type { ReadingState } from '$lib/reading/model';

export type WorkList = { id: string; name: string; playlist: boolean; entries: { id: string; position: number }[]; count: number };
export type WorkListPage = { items: WorkList[]; page: number; pages: number; total: number };
export type GameActionState = { platforms: string[]; playthrough: { id: string; status: GameStatus; progressPercent: number; repeat: boolean; platform: string | null } | null };
export type ReadingActionState = { state: ReadingState; page: number; totalPages: number | null };
export type WorkActionState = {
  reasons: { relationship: string; origin: string }[];
  rating: number | null; queued: boolean;
  game: GameActionState | null; reading: ReadingActionState | null;
};
