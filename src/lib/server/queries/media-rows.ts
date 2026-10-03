import { desc, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getConfig } from '$lib/server/config';
import { requireExperimentalFeature } from '$lib/server/experimental';
import { mapConcurrent } from '$lib/server/utils/async';
import { ownedGameAvailable } from '$lib/games/availability.server';
import { getDb } from '$lib/server/db';
import { games } from '$lib/server/db/schema';
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
  limit = 12,
  availableOnly = false
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
        const result = await musicLibrary(userId, connectionId, { kind, search, limit, availableOnly });
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
    .limit(12);
  return { items: items.map(({game,available}) => gameCard({...game,available})), failure: '' };
}

export async function presentationContent(userId: string, url: URL): Promise<PresentationRow> {
  const surface = v.parse(v.picklist(['listen', 'play']), url.searchParams.get('surface'));
  requireExperimentalFeature(await getConfig(), surface === 'listen' ? 'music' : 'gaming');
  if (surface === 'listen') {
    const kind = v.parse(
      v.picklist(['all', 'album', 'artist', 'track']),
      url.searchParams.get('selection') ?? 'all'
    );
    const scope = v.parse(v.picklist(['all', 'available']), url.searchParams.get('scope') ?? 'all');
    return musicRow(userId, '', kind, 12, scope === 'available');
  }
  const personal =
    v.parse(v.picklist(['true', 'false']), url.searchParams.get('personal') ?? 'false') === 'true';
  const scope = v.parse(v.picklist(['all', 'available']), url.searchParams.get('scope') ?? 'all');
  const state = v.parse(v.picklist(['all', 'planned', 'in-progress', 'completed', 'paused', 'dropped']), url.searchParams.get('selection') ?? 'all');
  if(state !== 'all') {
    const {listGames} = await import('$lib/core/games/service');
    const result = await listGames('',1,{userId,status:state,availableOnly:scope==='available'});
    return {items:result.items.slice(0,12).map(item=>gameCard(item)),failure:''};
  }
  return gameRow(userId, personal, scope==='available').catch(() => ({
    items: [],
    failure: 'Games could not be loaded. Please try again.',
  }));
}

// Only configuration is needed during SSR; off-screen providers load when their rows approach.
export async function mediaRows(personal = false) {
  const config=await getConfig();
  return { experimentalMusic:config.experimentalMusic, experimentalGaming:config.experimentalGaming, personal };
}
