import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '$lib/server/db';
import { readingProgress, readingWorks, readingSessions, users } from '$lib/server/db/schema';
import { DomainError } from '$lib/core/errors';
import { getConfig } from '$lib/server/config';
import { requireEnabledCategory } from '$lib/server/experimental';
import { emitWebhook } from '$lib/server/public-api/webhooks.server';
import { readingStates } from '$lib/reading/model';

const uuid = v.pipe(v.string(), v.uuid());
const pages = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000000));
export const readingProgressInputSchema = v.pipe(v.strictObject({
  restart: v.optional(v.literal(true)),
  state: v.optional(v.picklist(readingStates)),
  page: v.optional(pages),
  totalPages: v.optional(v.nullable(v.pipe(pages, v.minValue(1)))),
}), v.check((input) => input.state !== undefined || input.page !== undefined || input.totalPages !== undefined, 'Supply a reading state or page progress.'),
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

async function writeReading(userId:string,id:string,input:v.InferOutput<typeof readingProgressInputSchema>,initializeOnly=false){
  return getDb().transaction(tx=>writeReadingInTransaction(tx,userId,id,input,initializeOnly));
}
async function writeReadingInTransaction(tx:Transaction,userId:string,id:string,input:v.InferOutput<typeof readingProgressInputSchema>,initializeOnly=false){
    v.parse(uuid, userId); v.parse(uuid, id);
    const config = await getConfig();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.disabled, false)));
    if (!user) throw new DomainError('Sign in to update reading progress.', 401, 'unauthorized');
    const [item] = await tx.select({ id: readingWorks.id, kind: readingWorks.kind }).from(readingWorks).where(eq(readingWorks.id, id));
    if (!item) throw new DomainError('Reading work not found.', 404, 'not_found');
    requireEnabledCategory(config, item.kind);
    const key = and(eq(readingProgress.userId, userId), eq(readingProgress.workId, id));
    const [existing] = await tx.select().from(readingProgress).where(key);
    if(input.restart&&existing?.state!=='completed')throw new DomainError('Complete this read before starting a reread.',409);
    if (initializeOnly && existing) return existing;
    const page = input.page ?? existing?.page ?? 0;
    const totalPages = input.totalPages === undefined ? existing?.totalPages ?? null : input.totalPages;
    if (totalPages !== null && page > totalPages)
      throw new DomainError('The current page cannot be beyond the total pages.');
    const state = input.state ?? (page > 0 && (!existing || existing.state === 'planned') ? 'reading' : existing?.state ?? 'planned');
    if (existing && existing.state === state && existing.page === page && existing.totalPages === totalPages && !input.restart) return existing;
    const now = new Date();
    const values = {
      state, page, totalPages,
      startedAt: input.restart?now:existing?.startedAt ?? (page > 0 || state === 'reading' || state === 'completed' ? now : null),
      completedAt: state === 'completed' ? existing?.completedAt ?? now : null,
      updatedAt: now,
    };
    if(input.restart)await tx.update(readingSessions).set({location:null,closedAt:now}).where(and(eq(readingSessions.userId,userId),eq(readingSessions.workId,id)));
    const [progress] = await tx.insert(readingProgress).values({ userId, workId: id, ...values }).onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.workId], set: values,
    }).returning();
    await emitWebhook(tx,userId,'reading.changed',{workId:id,state:progress.state,page:progress.page,totalPages:progress.totalPages});
    return progress;
}
