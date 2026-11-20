import { lockFeaturePolicyInTransaction, requireFeatureInTransaction } from '#lib/server/features.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '#lib/server/db/index.js';
import { readingProgress, readingWorks, readingSessions, readingHistory, socialActivity, users } from '#lib/server/db/schema.js';
import { DomainError } from '#lib/core/errors.js';
import { getConfig } from '#lib/server/config.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { emitWebhook } from '#lib/server/public-api/webhooks.server.js';
import { initialReadingBookmarkCycle, readingStates } from '#lib/reading/model.js';

const uuid = v.pipe(v.string(), v.uuid());
const pages = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000000));
export const readingProgressInputSchema = v.pipe(v.strictObject({
  reset: v.optional(v.picklist(['position', 'unread'])),
  restart: v.optional(v.literal(true)),
  endReread: v.optional(uuid),
  state: v.optional(v.picklist(readingStates)),
  page: v.optional(pages),
  totalPages: v.optional(v.nullable(v.pipe(pages, v.minValue(1)))),
  occurredAt: v.optional(v.pipe(v.string(), v.isoTimestamp(), v.check(
    value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now(),
    'Choose a valid reading date in the past.',
  ))),
}), v.check(input => input.reset !== undefined || input.endReread !== undefined || input.state !== undefined || input.page !== undefined || input.totalPages !== undefined,
  'Supply a reading state or page progress.'),
v.check(input => !input.reset || !input.endReread && !input.restart && input.state === undefined && input.page === undefined &&
  input.totalPages === undefined && input.occurredAt === undefined, 'Reset reading separately from other reading changes.'),
v.check(input => !input.endReread || !input.restart && input.state === undefined && input.page === undefined &&
  input.totalPages === undefined && input.occurredAt === undefined, 'End the reread separately from other reading changes.'),
v.check(input => input.occurredAt === undefined || input.restart === true || input.state === 'completed',
  'Choose a date for a completed read or a reread.'),
v.check((input) => (!input.restart||input.state==='reading'&&input.page===0) && (input.totalPages == null || input.page === undefined || input.page <= input.totalPages), 'The current page cannot be beyond the total pages.'));

/** A full page count alone never marks a read complete; completion is an explicit, idempotent choice. */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function updateReading(userId: string, id: string, raw: unknown, tx?:Transaction) {
  const input=v.parse(readingProgressInputSchema,raw);
  return tx?writeReadingInTransaction(tx,userId,id,input):writeReading(userId,id,input);
}

/** Import retries save a new work for later without resetting existing reading choices. */
export async function ensureReadingSaved(userId:string,id:string){
  return writeReading(userId,id,{state:'planned'},true);
}

/** Removing one local journal entry never rewinds current progress or edition bookmarks. */
export async function removeReadingHistory(userId:string,workId:string,entryId:string){
  v.parse(uuid,userId);v.parse(uuid,workId);v.parse(uuid,entryId);
  return getDb().transaction(async tx=>{
    await lockFeaturePolicyInTransaction(tx,userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [work]=await tx.select({kind:readingWorks.kind}).from(readingWorks).where(eq(readingWorks.id,workId));
    if(!work)throw new DomainError('Reading work not found.',404);
    requireEnabledCategory(await getConfig(tx),work.kind);
    await requireFeatureInTransaction(tx,userId,work.kind);
    const removed=await tx.delete(readingHistory).where(and(eq(readingHistory.id,entryId),eq(readingHistory.userId,userId),eq(readingHistory.workId,workId))).returning({id:readingHistory.id});
    if(removed.length){
      await tx.delete(socialActivity).where(and(eq(socialActivity.userId,userId),eq(socialActivity.workId,workId),eq(socialActivity.sourceKey,`reading:${entryId}`)));
      await tx.execute(sql`select coast_bump_content_revision(${userId},'tracking')`);
    }
    return {removed:removed.length>0};
  });
}

async function writeReading(userId:string,id:string,input:v.InferOutput<typeof readingProgressInputSchema>,initializeOnly=false){
  return getDb().transaction(tx=>writeReadingInTransaction(tx,userId,id,input,initializeOnly));
}
async function writeReadingInTransaction(tx:Transaction,userId:string,id:string,input:v.InferOutput<typeof readingProgressInputSchema>,initializeOnly=false){
    v.parse(uuid, userId); v.parse(uuid, id);
    await lockFeaturePolicyInTransaction(tx,userId);
    const config = await getConfig(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.disabled, false)));
    if (!user) throw new DomainError('Sign in to update reading progress.', 401, 'unauthorized');
    const [item] = await tx.select({ id: readingWorks.id, kind: readingWorks.kind }).from(readingWorks).where(eq(readingWorks.id, id));
    if (!item) throw new DomainError('Reading work not found.', 404, 'not_found');
    requireEnabledCategory(config, item.kind);
    await requireFeatureInTransaction(tx,userId,item.kind);
    const key = and(eq(readingProgress.userId, userId), eq(readingProgress.workId, id));
    const [existing] = await tx.select().from(readingProgress).where(key);
    const now = new Date();
    const closeBookmarkCycle = (cycle: string) => tx.update(readingSessions).set({ closedAt: now }).where(and(
      eq(readingSessions.userId, userId), eq(readingSessions.workId, id), eq(readingSessions.bookmarkCycle, cycle),
      isNull(readingSessions.closedAt), isNull(readingSessions.shareId),
    ));
    if (input.reset) {
      if (!existing) throw new DomainError('There is no saved reading progress to reset.', 409);
      await closeBookmarkCycle(existing.bookmarkCycle);
      const [progress] = await tx.update(readingProgress).set({
        page: 0, bookmarkCycle: crypto.randomUUID(), updatedAt: now,
        ...(input.reset === 'unread' ? { state: 'planned' as const, startedAt: null, completedAt: null, rereadRestore: null } : {}),
      }).where(key).returning();
      await publishReadingChange(tx, userId, progress);
      return progress;
    }
    if (input.endReread) {
      if (!existing) throw new DomainError('This reread no longer exists.', 409);
      const restore = existing.rereadRestore;
      if (!restore) return existing;
      if (existing.bookmarkCycle !== input.endReread) throw new DomainError('This reread has changed. Reopen the menu and try again.', 409);
      await closeBookmarkCycle(existing.bookmarkCycle);
      const [progress] = await tx.update(readingProgress).set({
        state: 'completed', page: restore.page, totalPages: restore.totalPages,
        startedAt: restore.startedAt ? new Date(restore.startedAt) : null,
        completedAt: new Date(restore.completedAt), bookmarkCycle: restore.bookmarkCycle,
        rereadRestore: null, updatedAt: now,
      }).where(key).returning();
      await publishReadingChange(tx, userId, progress);
      return progress;
    }
    if (input.restart && existing?.state !== 'completed') throw new DomainError('Complete this read before starting a reread.', 409);
    if (initializeOnly && existing) return existing;
    const page = input.page ?? existing?.page ?? 0;
    const totalPages = input.totalPages === undefined ? existing?.totalPages ?? null : input.totalPages;
    if (totalPages !== null && page > totalPages)
      throw new DomainError('The current page cannot be beyond the total pages.');
    const state = input.state ?? (page > 0 && (!existing || existing.state === 'planned') ? 'reading' : existing?.state ?? 'planned');
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : undefined;
    const completedAt = state === 'completed' ? occurredAt ?? existing?.completedAt ?? now : null;
    if (existing && existing.state === state && existing.page === page && existing.totalPages === totalPages &&
      existing.completedAt?.getTime() === completedAt?.getTime() && !input.restart) return existing;
    const bookmarkCycle = existing?.bookmarkCycle ?? initialReadingBookmarkCycle;
    const rereadRestore = input.restart && existing?.completedAt ? {
      bookmarkCycle, page: existing.page, totalPages: existing.totalPages,
      startedAt: existing.startedAt?.toISOString() ?? null, completedAt: existing.completedAt.toISOString(),
    } : state === 'completed' ? null : existing?.rereadRestore ?? null;
    const values = {
      state, page, totalPages,
      startedAt: input.restart ? occurredAt ?? now : existing?.startedAt ?? (page > 0 || state === 'reading' || state === 'completed' ? occurredAt ?? now : null),
      completedAt, updatedAt: now, rereadRestore,
      bookmarkCycle: input.restart ? crypto.randomUUID() : bookmarkCycle,
    };
    if (input.restart) await closeBookmarkCycle(bookmarkCycle);
    const [progress] = await tx.insert(readingProgress).values({ userId, workId: id, ...values }).onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.workId], set: values,
    }).returning();
    await publishReadingChange(tx, userId, progress);
    return progress;
}

function publishReadingChange(tx: Transaction, userId: string, progress: typeof readingProgress.$inferSelect) {
  return emitWebhook(tx, userId, 'reading.changed', {
    workId: progress.workId, state: progress.state, page: progress.page, totalPages: progress.totalPages,
  });
}
