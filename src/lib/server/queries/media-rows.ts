import { desc, eq, inArray, sql } from 'drizzle-orm';
import { getConfig } from '$lib/server/config';
import { getDb } from '$lib/server/db';
import { games, gamePlaythroughs } from '$lib/server/db/schema';
import { listProviders } from '$lib/providers/instances.server';
import { musicLibrary } from '$lib/music/service.server';
import { musicCard } from '$lib/music/presentation';
import { gameCard } from '$lib/games/presentation';
import type { MediaCardPresentation } from '$lib/ui/types';

export type PresentationRow = { items: MediaCardPresentation[]; failure: string };
export async function musicRow(
  userId: string,
  search = '',
  kind: 'all' | 'album' | 'artist' | 'track' = 'all',
  limit = 12
): Promise<PresentationRow> {
  try {
    const sources = (await listProviders(userId)).filter(
      (source) =>
        source.provider === 'jellyfin' &&
        source.enabled &&
        source.connection?.status === 'connected'
    );
    const results = await Promise.all(
      sources.map(async (source) => {
        const connectionId = source.connection!.id;
        try {
          const result = await musicLibrary(userId, connectionId, { kind, search, limit });
          return { items: result.items.map((item) => musicCard(item, connectionId)), failure: '' };
        } catch {
          return { items: [], failure: `Music from ${source.name} could not be loaded.` };
        }
      })
    );
    return {
      items: results.flatMap((result) => result.items),
      failure: results
        .map((result) => result.failure)
        .filter(Boolean)
        .join(' '),
    };
  } catch {
    return { items: [], failure: 'Music could not be loaded. Please try again.' };
  }
}

/** Playthrough metadata stays scoped to its owner, just like the game detail page. */
export async function gameRow(userId: string, personal = false): Promise<PresentationRow> {
  const db = getDb();
  const items = await db
    .select()
    .from(games)
    .where(
      personal
        ? inArray(
            games.id,
            db
              .select({ id: gamePlaythroughs.gameId })
              .from(gamePlaythroughs)
              .where(eq(gamePlaythroughs.userId, userId))
          )
        : undefined
    )
    .orderBy(
      personal
        ? sql`(select max(updated_at) from game_playthroughs where game_id = ${games.id} and user_id = ${userId}) desc`
        : desc(games.createdAt),
      desc(games.id)
    )
    .limit(12);
  return { items: items.map((game) => gameCard(game)), failure: '' };
}

export async function mediaRows(userId: string, personal = false) {
  const enabled = (await getConfig()).experimentalFeatures;
  return {
    enabled,
    music: enabled ? musicRow(userId) : Promise.resolve({ items: [], failure: '' }),
    games: enabled
      ? gameRow(userId, personal).catch(() => ({
          items: [],
          failure: 'Games could not be loaded. Please try again.',
        }))
      : Promise.resolve({ items: [], failure: '' }),
  };
}
