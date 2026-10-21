import { and, asc, eq, exists, isNull, lte, or, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { rewatchFields } from '#lib/core/tracking/rewatch.server.js';
import { getDb } from '#lib/server/db/index.js';
import * as s from '#lib/server/db/schema.js';
import { requireFeature } from '#lib/server/features.js';
import { AppError } from '#lib/server/security/errors.js';
import { mediaViewsForIds, permittedAvailability } from './media';
import { PAGE_SIZE, pagination, pageNumberSchema } from './pagination';

/** All seasons in air-date order, hydrating only the page around the next unwatched episode. */
export async function showNext(userId: string, showId: string, requestedPage?: number, availableOnly = false, includeSpecials = false) {
  v.parse(v.pipe(v.string(), v.uuid()), showId);
  if (requestedPage !== undefined) v.parse(pageNumberSchema, requestedPage);
  await requireFeature(userId, 'screen');
  const db = getDb();
  const [show] = await db.select({ kind: s.media.kind }).from(s.media).where(eq(s.media.id, showId));
  if (show?.kind !== 'show') throw new AppError(404, 'This show was not found.');

  const order = [sql`${s.media.releaseDate} asc nulls last`, asc(s.episodes.seasonNumber), asc(s.episodes.episodeNumber), asc(s.media.id)];
  const state = rewatchFields(userId, sql`${s.media.id}`);
  const available = db.select({id:s.availability.id}).from(s.availability)
    .innerJoin(s.providerConnections,eq(s.providerConnections.id,s.availability.connectionId))
    .innerJoin(s.providerInstances,eq(s.providerInstances.id,s.providerConnections.instanceId))
    .where(and(permittedAvailability(userId),eq(s.availability.mediaId,s.media.id)));
  const scope = and(eq(s.episodes.showId,showId),includeSpecials?undefined:eq(s.episodes.isSpecial,false),availableOnly?exists(available):undefined);
  const due = and(
    eq(s.episodes.isSpecial, false),
    sql`not coalesce(${s.trackingState.dropped}, false)`,
    sql`not (${state.watched})`,
    or(isNull(s.media.releaseDate), lte(s.media.releaseDate, new Date().toISOString().slice(0, 10)))
  );
  const ordered = db.select({
    id: s.media.id,
    position: sql<number>`(row_number() over (order by ${sql.join(order, sql`, `)}))::int`.as('position'),
    total: sql<number>`(count(*) over ())::int`.as('total'),
    pending: sql<boolean>`${due}`.as('pending'),
    active: sql<boolean>`(${state.progress}) > 0`.as('active'),
  }).from(s.episodes)
    .innerJoin(s.media, eq(s.media.id, s.episodes.mediaId))
    .leftJoin(s.trackingState, and(eq(s.trackingState.userId, userId), eq(s.trackingState.mediaId, s.media.id)))
    .where(scope).as('ordered');
  const [next] = await db.select().from(ordered)
    .orderBy(sql`case when ${ordered.pending} and ${ordered.active} then 0 when ${ordered.pending} then 1 else 2 end`, asc(ordered.position)).limit(1);
  const total = next?.total ?? 0;
  const focusId = next?.pending ? next.id : undefined;
  const startPage = focusId ? Math.floor((next.position - 1) / PAGE_SIZE) + 1 : 1;
  const { page, pages } = pagination(total, requestedPage ?? startPage);
  const entries = await db.select({ id: s.media.id }).from(s.episodes)
    .innerJoin(s.media, eq(s.media.id, s.episodes.mediaId))
    .where(scope).orderBy(...order)
    .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  return { items: await mediaViewsForIds(userId, entries.map(entry => entry.id)), page, pages, total, focusId };
}
