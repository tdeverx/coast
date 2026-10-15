import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../../server/db';
import { works, upNext } from '../../server/db/schema';
import { DomainError } from '../errors';
import { enqueueCollectionProjectionInTransaction } from '../../sync/changes.server';

export async function setUpNext(userId: string, raw: unknown) {
  const input = v.parse(
    v.object({ mediaId: v.pipe(v.string(), v.uuid()), queued: v.boolean() }),
    raw
  );
  return getDb().transaction(async db=>{
  if (!input.queued) {
    await db
      .delete(upNext)
      .where(and(eq(upNext.userId, userId), eq(upNext.mediaId, input.mediaId)));
    await enqueueCollectionProjectionInTransaction(db,userId);
    return;
  }
  const [item] = await db.select({ id: works.id }).from(works).where(eq(works.id, input.mediaId));
  if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
  await db.insert(upNext).values({ userId, mediaId: input.mediaId }).onConflictDoNothing();
  await enqueueCollectionProjectionInTransaction(db,userId);
  });
}
