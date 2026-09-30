import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '../../server/db';
import { works, ratings } from '../../server/db/schema';
import { DomainError } from '../errors';

export const ratingValueSchema = v.nullable(
  v.pipe(
    v.number(),
    v.finite(),
    v.minValue(0.5),
    v.maxValue(5),
    v.check((value) => Number.isInteger(value * 2), 'Ratings use half-star steps.')
  )
);
export const ratingInputSchema = v.object({
  mediaId: v.pipe(v.string(), v.uuid()),
  value: ratingValueSchema,
});
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function rate(userId: string, raw: v.InferInput<typeof ratingInputSchema>) {
  return (await getDb().transaction((tx) => rateInTransaction(tx, userId, raw))).rating;
}
export async function rateInTransaction(
  tx: Transaction,
  userId: string,
  raw: v.InferInput<typeof ratingInputSchema>
) {
  v.parse(v.pipe(v.string(), v.uuid()), userId);
  const input = v.parse(ratingInputSchema, raw);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
  const [item] = await tx.select({ id: works.id }).from(works).where(eq(works.id, input.mediaId));
  if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
  const [existing] = await tx
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.mediaId, input.mediaId)));
  if (input.value === null) {
    if (existing)
      await tx
        .delete(ratings)
        .where(and(eq(ratings.userId, userId), eq(ratings.mediaId, input.mediaId)));
    return { rating: null, changed: Boolean(existing) };
  }
  if (existing?.value === input.value && existing.source === 'coast')
    return { rating: existing, changed: false };
  const [rating] = await tx
    .insert(ratings)
    .values({ userId, mediaId: input.mediaId, value: input.value })
    .onConflictDoUpdate({
      target: [ratings.userId, ratings.mediaId],
      set: { value: input.value, source: 'coast', updatedAt: new Date() },
    })
    .returning();
  return { rating, changed: existing?.value !== input.value };
}
