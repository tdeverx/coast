import { desc, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getConfig } from '$lib/server/config';
import { requireExperimentalFeatures } from '$lib/server/experimental';
import { mapConcurrent } from '$lib/server/utils/async';
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
    const results = await mapConcurrent(sources, 4, async (source) => {
      const connectionId = source.connection!.id;
      try {
        const result = await musicLibrary(userId, connectionId, { kind, search, limit });
        return { items: result.items.map((item) => musicCard(item, connectionId)), failure: '' };
      } catch {
        return { items: [], failure: `Music from ${source.name} could not be loaded.` };
      }
    });
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

export async function presentationContent(userId: string, url: URL): Promise<PresentationRow> {
  requireExperimentalFeatures(await getConfig());
  const surface = v.parse(v.picklist(['listen', 'play']), url.searchParams.get('surface'));
  if (surface === 'listen') {
    const kind = v.parse(
      v.picklist(['all', 'album', 'artist', 'track']),
      url.searchParams.get('selection') ?? 'all'
    );
    return musicRow(userId, '', kind);
  }
  const personal =
    v.parse(v.picklist(['true', 'false']), url.searchParams.get('personal') ?? 'false') === 'true';
  return gameRow(userId, personal).catch(() => ({
    items: [],
    failure: 'Games could not be loaded. Please try again.',
  }));
}

// Only configuration is needed during SSR; off-screen providers load when their rows approach.
export async function mediaRows(personal = false) {
  return { enabled: (await getConfig()).experimentalFeatures, personal };
}
