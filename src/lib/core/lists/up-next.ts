import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../../server/db';
import { media, upNext } from '../../server/db/schema';
import { DomainError } from '../errors';

export async function setUpNext(userId: string, raw: unknown) {
  const input = v.parse(
    v.object({ mediaId: v.pipe(v.string(), v.uuid()), queued: v.boolean() }),
    raw
  );
  const db = getDb();
  if (!input.queued) {
    await db
      .delete(upNext)
      .where(and(eq(upNext.userId, userId), eq(upNext.mediaId, input.mediaId)));
    return;
  }
  const [item] = await db.select({ id: media.id }).from(media).where(eq(media.id, input.mediaId));
  if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
  await db.insert(upNext).values({ userId, mediaId: input.mediaId }).onConflictDoNothing();
}
