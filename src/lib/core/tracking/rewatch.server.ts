import { and, eq, sql, type SQL } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../../server/db';
import { media, rewatches, trackingState } from '../../server/db/schema';
import { DomainError } from '../errors';

/** A viewing boundary, never a mutation of canonical watched history. */
export function rewatchBoundary(userId: string, mediaId: SQL) {
  return sql<Date | null>`(select max(r.started_at) from rewatches r where r.user_id=${userId}
    and (r.media_id=${mediaId}
      or r.media_id in (select e.show_id from episodes e where e.media_id=${mediaId})
      or r.media_id in (select e.season_id from episodes e where e.media_id=${mediaId})
      or r.media_id in (select se.media_id from seasons se where se.show_id=${mediaId})
      or r.media_id in (select se.show_id from seasons se where se.media_id=${mediaId})))`;
}
export function rewatchFields(userId: string, mediaId: SQL, state = sql`tracking_state`) {
  const boundary = rewatchBoundary(userId, mediaId);
  return {
    watched: sql<boolean>`coalesce(${state}.watched,false) and (${boundary} is null or ${state}.last_watched_at >= ${boundary})`,
    progress: sql<number>`case when ${boundary} is null then coalesce(${state}.position_seconds,0)
      else coalesce((select case when event.action='progress' then event.position_seconds else 0 end
        from tracking_events event where event.user_id=${userId} and event.media_id=${mediaId}
          and event.applied and event.occurred_at_known and event.occurred_at>=${boundary}
          and event.action in ('progress','watch','unwatch')
        order by event.occurred_at desc,event.id desc limit 1),0) end`,
  };
}
export async function setRewatch(userId: string, raw: unknown) {
  const input = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      startedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
    }),
    raw
  );
  const startedAt = input.startedAt ? new Date(input.startedAt) : null;
  if (startedAt && startedAt.getTime() > Date.now())
    throw new DomainError('Choose a start date in the past or now.');
  const db = getDb();
  const [item] = await db
    .select({ kind: media.kind })
    .from(media)
    .where(eq(media.id, input.mediaId));
  if (!item || !['movie', 'show', 'season', 'episode', 'collection'].includes(item.kind))
    throw new DomainError('This title cannot be rewatched.');
  if (!startedAt) {
    await db
      .delete(rewatches)
      .where(and(eq(rewatches.userId, userId), eq(rewatches.mediaId, input.mediaId)));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    // A whole-show run supersedes old season/episode boundaries, never historical watches.
    if (item.kind === 'show')
      await tx
        .delete(rewatches)
        .where(
          and(
            eq(rewatches.userId, userId),
            sql`${rewatches.mediaId} in (select media_id from seasons where show_id=${input.mediaId} union select media_id from episodes where show_id=${input.mediaId})`
          )
        );
    await tx
      .insert(trackingState)
      .values({ userId, mediaId: input.mediaId, dropped: false })
      .onConflictDoUpdate({
        target: [trackingState.userId, trackingState.mediaId],
        set: { dropped: false },
      });
    await tx
      .insert(rewatches)
      .values({ userId, mediaId: input.mediaId, startedAt })
      .onConflictDoUpdate({ target: [rewatches.userId, rewatches.mediaId], set: { startedAt } });
  });
}
