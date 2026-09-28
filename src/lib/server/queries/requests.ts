import { and, asc, desc, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { mediaViewsForIds } from './media';
import { pageNumberSchema, PAGE_SIZE, pagination } from './pagination';

export async function requestList(userId: string, requestedPage = 1, requestId?: string) {
  v.parse(v.pipe(v.string(), v.uuid()), userId);
  v.parse(pageNumberSchema, requestedPage);
  const db = getDb();
  if (requestId) v.parse(v.pipe(v.string(), v.uuid()), requestId);
  const where = and(
    eq(s.mediaRequests.userId, userId),
    requestId ? eq(s.mediaRequests.id, requestId) : undefined
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(s.mediaRequests)
    .where(where);
  const pageSize = PAGE_SIZE;
  const total = count.total;
  const { page, pages } = pagination(total, requestedPage);
  const rows = await db
    .select({ request: s.mediaRequests, destination: s.providerInstances.name })
    .from(s.mediaRequests)
    .innerJoin(s.providerInstances, eq(s.mediaRequests.instanceId, s.providerInstances.id))
    .where(where)
    .orderBy(desc(s.mediaRequests.createdAt), asc(s.mediaRequests.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const views = new Map(
    (
      await mediaViewsForIds(
        userId,
        rows.map((row) => row.request.mediaId)
      )
    ).map((item) => [item.id, item])
  );
  return {
    requests: rows.map((row) => ({
      ...row.request,
      destination: row.destination,
      item: views.get(row.request.mediaId),
    })),
    total,
    page,
    pages,
    pageSize,
  };
}
