import { lockFeaturePolicyInTransaction, requireWorkFeature } from '#lib/server/features.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '../../server/db';
import * as s from '../../server/db/schema';
import { DomainError } from '../errors';
import { consumedQueueCondition, trackInTransaction } from './service.server';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const uuid = v.pipe(v.string(), v.uuid());
const snapshotSchema = v.object({
  dropped: v.boolean(),
  queued: v.array(v.object({ mediaId: uuid, addedAt: v.pipe(v.string(), v.isoTimestamp()) })),
});
export type ContinueSnapshot = v.InferOutput<typeof snapshotSchema>;
/** Episode/season menu actions always target their whole show. */
export async function wholeWorkId(db: Database | Transaction, mediaId: string) {
  v.parse(uuid, mediaId);
  const [item] = await db.select().from(s.media).where(eq(s.media.id, mediaId));
  if (!item) throw new DomainError('Title not found.', 404);
  if (item.kind === 'episode') {
    const [episode] = await db.select().from(s.episodes).where(eq(s.episodes.mediaId, mediaId));
    if (!episode) throw new DomainError('This episode has no show.');
    return episode.showId;
  }
  if (item.kind === 'season') {
    const [season] = await db.select().from(s.seasons).where(eq(s.seasons.mediaId, mediaId));
    if (!season) throw new DomainError('This season has no show.');
    return season.showId;
  }
  return mediaId;
}
/** A drop hides the work from Progress and preserves its rewatch boundary and viewing events. */
export async function changeContinue(userId: string, raw: unknown) {
  const input = v.parse(
    v.object({
      mediaId: uuid,
      action: v.picklist(['add', 'remove', 'undo']),
      eventId: v.optional(uuid),
      previous: v.optional(snapshotSchema),
    }),
    raw
  );
  return getDb().transaction(async (tx) => {
    await lockFeaturePolicyInTransaction(tx,userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    await requireWorkFeature(tx,userId,input.mediaId);
    const mediaId = await wholeWorkId(tx, input.mediaId);
    const [state] = await tx
      .select({ dropped: s.trackingState.dropped })
      .from(s.trackingState)
      .where(and(eq(s.trackingState.userId, userId), eq(s.trackingState.mediaId, mediaId)));
    if (input.action === 'undo') {
      if (!input.previous || !input.eventId)
        throw new DomainError('Missing the previous Continue state.');
      const [latest] = await tx
        .select({ id: s.trackingEvents.id, action: s.trackingEvents.action })
        .from(s.trackingEvents)
        .where(and(eq(s.trackingEvents.userId, userId), eq(s.trackingEvents.mediaId, mediaId)))
        .orderBy(desc(s.trackingEvents.createdAt), desc(s.trackingEvents.id))
        .limit(1);
      if (!state?.dropped || latest?.id !== input.eventId || latest.action !== 'drop')
        throw new DomainError(
          'This title has changed since removal. Restore it from its menu instead.',
          409
        );
      await trackInTransaction(tx, userId, {
        mediaId,
        action: input.previous.dropped ? 'drop' : 'restore',
        acknowledged: true,
      });
      if (input.previous.queued.length)
        await tx
          .insert(s.upNext)
          .values(
            input.previous.queued.map((row) => ({
              userId,
              mediaId: row.mediaId,
              addedAt: new Date(row.addedAt),
            }))
          )
          .onConflictDoNothing();
      return { mediaId };
    }
    if (input.action === 'add') {
      if (state?.dropped)
        await trackInTransaction(tx, userId, { mediaId, action: 'restore', acknowledged: true });
      await tx.insert(s.upNext).values({ userId, mediaId }).onConflictDoNothing();
      return { mediaId, restored: !!state?.dropped };
    }
    const queued = await tx.select().from(s.upNext).where(consumedQueueCondition(userId, mediaId));
    const result = await trackInTransaction(tx, userId, {
      mediaId,
      action: 'drop',
      acknowledged: true,
    });
    return {
      mediaId,
      eventId: result.eventId,
      previous: {
        dropped: state?.dropped ?? false,
        queued: queued
          .filter((row) => result.removedQueueIds?.includes(row.mediaId))
          .map((row) => ({ mediaId: row.mediaId, addedAt: row.addedAt.toISOString() })),
      },
    };
  });
}
