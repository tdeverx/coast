import { and, asc, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { episodeHasAired } from '#lib/catalogue/metadata/release-date.server.js';
import { getDb } from '#lib/server/db/index.js';
import { episodes, media, musicWorks } from '#lib/server/db/schema.js';
import { requireFeature } from '#lib/server/features.js';
import { AppError } from '#lib/server/security/errors.js';
import { pageNumberSchema } from '#lib/server/queries/pagination.js';
import { canonicalArtistTrackSql } from '#lib/music/artist-tracks.server.js';
import type { ActiveCheckin, CheckinEpisodePage, CheckinTrackPage } from './checkins';

const PAGE_SIZE = 20;
const uuid = v.pipe(v.string(), v.uuid());

/** At most one row via the existing per-viewer active index. Group ownership is a leaf probe. */
export function activeCheckinSql(userId: string, workId: string, scope?: 'show' | 'season' | 'artist') {
  const matches = scope==='artist' ? canonicalArtistTrackSql(workId,sql`c.work_id`) : scope
    ? sql`exists(select 1 from episodes e where e.media_id=c.work_id
        and ${scope === 'show' ? sql`e.show_id` : sql`e.season_id`}=${workId}::uuid)`
    : sql`c.work_id=${workId}::uuid`;
  return sql<ActiveCheckin | null>`(
    select jsonb_build_object('id',c.id,'workId',c.work_id,'mode',c.mode,'expiresAt',c.expires_at)
    from social_checkins c where c.user_id=${userId}::uuid and c.state='active' and c.expires_at>now()
      and ${matches}
  )`;
}

/** The episode chooser needs labels only. Media hydration and provider access are unnecessary. */
export async function checkinEpisodes(userId: string, workId: string, requestedPage: number): Promise<CheckinEpisodePage> {
  v.parse(uuid, workId);
  const page = v.parse(pageNumberSchema, requestedPage);
  const config = await requireFeature(userId, 'presence');
  if (!config.features.screen) throw new AppError(403, 'This medium is turned off.', 'feature_disabled');
  const db = getDb();
  const [parent] = await db.select({kind: media.kind}).from(media).where(eq(media.id, workId));
  if (parent?.kind !== 'show' && parent?.kind !== 'season') throw new AppError(404, 'Choose a show or season.');
  const number = parent.kind === 'show' ? episodes.showId : episodes.seasonId;
  const items = await db.select({id: episodes.mediaId, title: media.title, seasonNumber: episodes.seasonNumber, episodeNumber: episodes.episodeNumber})
    .from(episodes).innerJoin(media, eq(media.id, episodes.mediaId))
    .where(and(eq(number, workId), eq(episodes.isSpecial, false), episodeHasAired(sql`${episodes.mediaId}`, config.metadataSource)))
    .orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber), asc(episodes.mediaId))
    .limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE);
  return { items: items.slice(0, PAGE_SIZE), hasMore: items.length > PAGE_SIZE };
}

/** Artist metadata chooses concrete tracks; a check-in never consumes the artist as a whole. */
export async function checkinArtistTracks(userId: string, workId: string, requestedPage: number): Promise<CheckinTrackPage> {
  v.parse(uuid, workId);
  const page = v.parse(pageNumberSchema, requestedPage);
  const config = await requireFeature(userId, 'presence');
  if (!config.features.music) throw new AppError(403, 'This medium is turned off.', 'feature_disabled');
  const db = getDb();
  const [artist] = await db.select({id:musicWorks.id}).from(musicWorks).where(and(eq(musicWorks.id,workId),eq(musicWorks.kind,'artist')));
  if(!artist)throw new AppError(404,'Artist not found.');
  const items = await db.select({ id: musicWorks.id, title: musicWorks.title }).from(musicWorks)
    .where(and(eq(musicWorks.kind, 'track'), canonicalArtistTrackSql(workId, sql`${musicWorks.id}`)))
    .orderBy(sql`${musicWorks.releaseDate} nulls last`, asc(musicWorks.title), asc(musicWorks.id))
    .limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE);
  const [active] = await db.execute<{ value: ActiveCheckin }>(sql`
    select jsonb_build_object('id',c.id,'workId',c.work_id,'mode',c.mode,'expiresAt',c.expires_at) as value
    from social_checkins c where c.user_id=${userId}::uuid and c.state='active' and c.expires_at>now()
      and ${canonicalArtistTrackSql(workId, sql`c.work_id`)}`);
  return { items: items.slice(0, PAGE_SIZE), hasMore: items.length > PAGE_SIZE, activeCheckin: active?.value ?? null };
}
