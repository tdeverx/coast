import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../../server/db';
import { episodes, externalIds, media, movies, seasons, shows, users } from '../../server/db/schema';
import { AppError } from '../../server/security/errors';
import { DomainError } from '../errors';
import { trackInTransaction } from '../tracking/service';

const uuidSchema = v.pipe(v.string(), v.uuid());
export const localEpisodesInputSchema = v.object({
  showId: uuidSchema,
  seasonNumber: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
  episodeCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
});
export async function createLocalMedia(userId: string, raw: unknown) {
  v.parse(uuidSchema, userId);
  const input = v.parse(
    v.object({
      title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250)),
      kind: v.picklist(['movie', 'show']),
      year: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1800), v.maxValue(2200))),
      overview: v.optional(v.pipe(v.string(), v.maxLength(5000))),
    }),
    raw
  );
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.disabled, false)));
    if (!user) throw new AppError(401, 'Sign in to add a title.');
    const [item] = await tx.insert(media).values(input).returning();
    if (input.kind === 'movie') await tx.insert(movies).values({ mediaId: item.id });
    else await tx.insert(shows).values({ mediaId: item.id });
    await trackInTransaction(tx, userId, { mediaId: item.id, action: 'watchlist', value: true });
    return item;
  });
}

/** Extend a manual show to a desired episode count; existing canonical identities are never replaced. */
export async function addLocalSeasonEpisodes(
  userId: string,
  showId: string,
  seasonNumber: number,
  episodeCount: number
) {
  v.parse(uuidSchema, userId);
  const input = v.parse(localEpisodesInputSchema, { showId, seasonNumber, episodeCount });
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`local-show:${showId}`}, 0))`
    );
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.disabled, false)));
    if (!user) throw new DomainError('Sign in to add episodes.', 401, 'unauthorized');
    const [show] = await tx
      .select()
      .from(media)
      .where(and(eq(media.id, showId), eq(media.kind, 'show')));
    if (!show) throw new DomainError('This show was not found.', 404, 'not_found');
    const [providerId] = await tx
      .select({ id: externalIds.id })
      .from(externalIds)
      .where(eq(externalIds.mediaId, showId))
      .limit(1);
    if (providerId)
      throw new DomainError(
        'Refresh the connected catalogue to add episodes to a provider-backed show. Manual episodes are for locally created shows.'
      );
    let [season] = await tx
      .select()
      .from(seasons)
      .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, input.seasonNumber)));
    if (!season) {
      const [item] = await tx
        .insert(media)
        .values({
          kind: 'season',
          title: `${show.title} · ${seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`}`,
        })
        .returning({ id: media.id });
      [season] = await tx
        .insert(seasons)
        .values({ mediaId: item.id, showId, seasonNumber })
        .returning();
    }
    const existing = await tx
      .select({ number: episodes.episodeNumber })
      .from(episodes)
      .where(and(eq(episodes.showId, showId), eq(episodes.seasonNumber, seasonNumber)));
    const numbers = new Set(existing.map((episode) => episode.number));
    let added = 0;
    for (let number = 1; number <= input.episodeCount; number += 1) {
      if (numbers.has(number)) continue;
      const [item] = await tx
        .insert(media)
        .values({
          kind: 'episode',
          title: `${show.title} · S${String(seasonNumber).padStart(2, '0')}E${String(number).padStart(2, '0')}`,
        })
        .returning({ id: media.id });
      await tx
        .insert(episodes)
        .values({
          mediaId: item.id,
          showId,
          seasonId: season.mediaId,
          seasonNumber,
          episodeNumber: number,
          isSpecial: seasonNumber === 0,
        });
      added += 1;
    }
    if (added) {
      // Adding regular episodes can make an already-completed show incomplete. History is preserved.
      await tx.execute(
        sql`update tracking_state set total_episodes = (select count(*) from episodes where show_id = ${showId} and not is_special), watched = completed_episodes > 0 and completed_episodes = (select count(*) from episodes where show_id = ${showId} and not is_special), updated_at = now() where media_id = ${showId}`
      );
      await tx.execute(
        sql`update tracking_state set total_episodes = (select count(*) from episodes where season_id = ${season.mediaId} and not is_special), watched = completed_episodes > 0 and completed_episodes = (select count(*) from episodes where season_id = ${season.mediaId} and not is_special), updated_at = now() where media_id = ${season.mediaId}`
      );
    }
    return { showId, seasonId: season.mediaId, added, total: existing.length + added };
  });
}
