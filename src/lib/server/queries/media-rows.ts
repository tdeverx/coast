import { getFeatureConfig } from '#lib/server/features.js';
import { personaliseWorkCards } from '#lib/catalogue/overrides/presentation.server.js';
import { desc, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { requireExperimentalFeature } from '#lib/server/experimental.js';
import { mapConcurrent } from '#lib/server/utils/async.js';
import { ownedGameAvailable } from '#lib/games/availability.server.js';
import { getDb } from '#lib/server/db/index.js';
import { games } from '#lib/server/db/schema.js';
import { listProviders } from '#lib/providers/instances.server.js';
import { musicLibrary } from '#lib/music/service.server.js';
import { musicCard } from '#lib/music/presentation.js';
import { gameCard } from '#lib/games/presentation.js';
import type { MediaCardPresentation } from '#lib/ui/types.js';

export type PresentationRow = { items: MediaCardPresentation[]; failure: string };
const GAME_PREVIEW_LIMIT = 12;
export async function musicRow(
  userId: string,
  search = '',
  kind: 'all' | 'album' | 'artist' | 'track' = 'all',
  limit = 12,
  availableOnly = false,
  signal?:AbortSignal
): Promise<PresentationRow> {
  signal?.throwIfAborted();
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
        const result = await musicLibrary(userId, connectionId, { kind, search, limit, availableOnly },signal);
        return { items: result.items.map((item) => musicCard(item, connectionId)), failure: '' };
      } catch {
        signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    return { items: [], failure: 'Music could not be loaded. Please try again.' };
  }
}

/** Playthrough metadata stays scoped to its owner, just like the game detail page. */
export async function gameRow(userId: string, personal = false, availableOnly = false): Promise<PresentationRow> {
  const db = getDb();
  const items = await db
    .select({game:games,available:ownedGameAvailable(userId)})
    .from(games)
    .where(sql`(${!personal} or exists(select 1 from game_playthroughs where user_id=${userId} and game_id=${games.id}) or exists(select 1 from tracking_state where user_id=${userId} and media_id=${games.id} and (collected or watchlist or favourite))) and (${!availableOnly} or ${ownedGameAvailable(userId)})`)
    .orderBy(
      personal
        ? sql`(select max(updated_at) from game_playthroughs where game_id = ${games.id} and user_id = ${userId}) desc`
        : desc(games.createdAt),
      desc(games.id)
    )
    .limit(GAME_PREVIEW_LIMIT);
  return { items: await personaliseWorkCards(userId,items.map(({game,available}) => gameCard({...game,available}))), failure: '' };
}

export async function presentationContent(userId: string, url: URL,signal?:AbortSignal): Promise<PresentationRow> {
  signal?.throwIfAborted();
  const surface = v.parse(v.picklist(['listen', 'play']), url.searchParams.get('surface'));
  requireExperimentalFeature(await getFeatureConfig(userId), surface === 'listen' ? 'music' : 'gaming');
  if (surface === 'listen') {
    const kind = v.parse(
      v.picklist(['all', 'album', 'artist', 'track']),
      url.searchParams.get('selection') ?? 'all'
    );
    const scope = v.parse(v.picklist(['all', 'available']), url.searchParams.get('scope') ?? 'all');
    return musicRow(userId, '', kind, 12, scope === 'available',signal);
  }
  const personal =
    v.parse(v.picklist(['true', 'false']), url.searchParams.get('personal') ?? 'false') === 'true';
  const scope = v.parse(v.picklist(['all', 'available']), url.searchParams.get('scope') ?? 'all');
  const state = v.parse(v.picklist(['all', 'planned', 'in-progress', 'completed', 'paused', 'dropped']), url.searchParams.get('selection') ?? 'all');
  if(state !== 'all') {
    const {listGames} = await import('#lib/core/games/service.server.js');
    const result = await listGames('',1,{userId,status:state,availableOnly:scope==='available'},GAME_PREVIEW_LIMIT);
    return {items:result.items.map(item=>gameCard(item)),failure:''};
  }
  return gameRow(userId, personal, scope==='available').catch(() => ({
    items: [],
    failure: 'Games could not be loaded. Please try again.',
  }));
}

// Only configuration is needed during SSR; off-screen providers load when their rows approach.
export async function mediaRows(personal = false, userId: string | null = null) {
  const config=await getFeatureConfig(userId);
  return { experimentalMusic:config.experimentalMusic, experimentalGaming:config.experimentalGaming, experimentalBooks:config.experimentalBooks, experimentalComics:config.experimentalComics, personal };
}
