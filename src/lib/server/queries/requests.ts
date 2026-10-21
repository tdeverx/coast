import { and, asc, desc, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { mediaViewsForIds } from './media';
import { pageNumberSchema, PAGE_SIZE, pagination } from './pagination';
import {AppError} from '../security/errors';

export async function requestList(userId: string, requestedPage = 1, requestId?: string,filters:{state?:'all'|typeof s.mediaRequests.$inferSelect.state;kind?:'all'|'movie'|'show';pageSize?:number;allUsers?:boolean}={},signal?:AbortSignal) {
  signal?.throwIfAborted();
  v.parse(v.pipe(v.string(), v.uuid()), userId);
  v.parse(pageNumberSchema, requestedPage);
  const db = getDb();
  if(filters.allUsers){
    const [actor]=await db.select({role:s.users.role}).from(s.users).where(eq(s.users.id,userId));
    if(actor?.role!=='admin')throw new AppError(403,'Only administrators can browse all requests.');
  }
  signal?.throwIfAborted();
  if (requestId) v.parse(v.pipe(v.string(), v.uuid()), requestId);
  const where = and(
    filters.allUsers?undefined:eq(s.mediaRequests.userId, userId),
    requestId ? eq(s.mediaRequests.id, requestId) : undefined,
    filters.state&&filters.state!=='all'?eq(s.mediaRequests.state,filters.state):undefined,
    filters.kind&&filters.kind!=='all'?eq(s.media.kind,filters.kind):undefined
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(s.mediaRequests)
    .innerJoin(s.media,eq(s.media.id,s.mediaRequests.mediaId))
    .where(where);
  signal?.throwIfAborted();
  const pageSize = v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(PAGE_SIZE)),filters.pageSize??PAGE_SIZE);
  const total = count.total;
  const { page, pages } = pagination(total, requestedPage,pageSize);
  const rows = await db
    .select({ request: s.mediaRequests, destination: s.providerInstances.name,requester:{username:s.users.username,avatar:sql<string|null>`${s.users.settings}->'profile'->>'avatar'`} })
    .from(s.mediaRequests)
    .innerJoin(s.media,eq(s.media.id,s.mediaRequests.mediaId))
    .innerJoin(s.users,eq(s.users.id,s.mediaRequests.userId))
    .innerJoin(s.providerInstances, eq(s.mediaRequests.instanceId, s.providerInstances.id))
    .where(where)
    .orderBy(desc(s.mediaRequests.createdAt), asc(s.mediaRequests.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  signal?.throwIfAborted();
  const views = new Map(
    (
      await mediaViewsForIds(
        userId,
        rows.map((row) => row.request.mediaId)
      )
    ).map((item) => [item.id, item])
  );
  signal?.throwIfAborted();
  return {
    requests: rows.map((row) => ({
      ...row.request,
      destination: row.destination,
      requester:{username:row.requester.username,avatar:row.requester.avatar??undefined},
      item: views.get(row.request.mediaId),
    })),
    total,
    page,
    pages,
    pageSize,
  };
}
