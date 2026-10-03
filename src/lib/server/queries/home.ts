import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import * as s from '../db/schema';
import { heroTitleIds, isHeroTitle } from '../../media/hero';
import type { MediaView } from '../../ui/types';
import { progressData } from './progress';
import { mediaViewsForIds, mediaViews, nextPlayable, permittedAvailability } from './media';

export async function homeData(userId: string) {
  const states = await getDb()
    .select()
    .from(s.trackingState)
    .where(eq(s.trackingState.userId, userId))
    .orderBy(desc(s.trackingState.updatedAt));
  const resumeStates = states.filter(
    (state, index) =>
      index < 300 ||
      (state.positionSeconds > 0 &&
        (!state.durationSeconds || state.positionSeconds < state.durationSeconds * 0.9))
  );
  const progress = await progressData(userId);
  const all = await mediaViewsForIds(userId, [...resumeStates.map((state) => state.mediaId)]);
  const byId = new Map(all.map((item) => [item.id, item]));
  const stateById = new Map(states.map((state) => [state.mediaId, state]));
  const ordered = states.flatMap((state) =>
    byId.get(state.mediaId) ? [byId.get(state.mediaId)!] : []
  );
  const continueWatching = progress.items.filter((item): item is MediaView => !('href' in item));
  const watchlist = ordered.filter(
    (item) =>
      item.watchlist &&
      !item.watched &&
      !item.dropped &&
      (stateById.get(item.id)?.completedEpisodes ?? 0) === 0
  );
  const recentlyWatched = ordered.filter(
    (item) => item.watched && ['movie', 'episode'].includes(item.kind)
  );
  const libraryRoot = sql<string>`coalesce(${s.episodes.showId}, ${s.availability.mediaId})`;
  const availableRoots = await getDb()
    .select({ id: libraryRoot })
    .from(s.availability)
    .innerJoin(s.providerConnections, eq(s.availability.connectionId, s.providerConnections.id))
    .innerJoin(s.providerInstances, eq(s.providerConnections.instanceId, s.providerInstances.id))
    .leftJoin(s.episodes, eq(s.episodes.mediaId, s.availability.mediaId))
    .where(permittedAvailability(userId))
    .groupBy(libraryRoot)
    .orderBy(desc(sql`max(${s.availability.verifiedAt})`))
    .limit(100);
  const library = await mediaViews(userId, {
    ids: availableRoots.map((row) => row.id),
    limit: 100,
  });
  const heroId = heroTitleIds([
    ...continueWatching,
    ...watchlist,
    ...library,
    ...recentlyWatched,
  ])[0];
  const heroCandidate = heroId
    ? ([...all, ...library].find((item) => item.id === heroId) ??
      (await mediaViewsForIds(userId, [heroId]))[0])
    : null;
  const hero = heroCandidate && isHeroTitle(heroCandidate) ? heroCandidate : null;
  const heroNext = hero ? await nextPlayable(userId, hero) : null;
  return {
    continueWatching,
    watchlist,
    progress,
    hero,
    heroNext,
  };
}
