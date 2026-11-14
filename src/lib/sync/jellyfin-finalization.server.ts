import { and, eq, asc, sql } from 'drizzle-orm';
import type { Database } from '#lib/server/db/index.js';
import { trackingState, musicProgress, reconciliationIntents } from '#lib/server/db/schema.js';
import { enqueueInTransaction } from './changes.server';
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export const JELLYFIN_FINALIZATION_BATCH = 100;
export type FinalizationCursor = {
    phase: 'screen' | 'music' | 'enqueue' | 'done';
    workId: string | null;
    category: string | null;
    processed: number;
};
/** The caller fences account/generation/lease first and commits this cursor in
 * the same transaction. No provider I/O or unbounded history walk occurs here. */
export async function reconcileJellyfinBatch(tx: Transaction, userId: string, connectionId: string, scanId: string, previous: FinalizationCursor): Promise<FinalizationCursor> {
    const cursor = { ...previous };
    if (cursor.phase === 'done')
        return cursor;
    if (cursor.phase === 'screen') {
        const states = await tx.select().from(trackingState).where(and(eq(trackingState.userId, userId), sql `(${trackingState.favourite} or ${trackingState.watched} or ${trackingState.positionSeconds}>0)`, cursor.workId ? sql `${trackingState.mediaId}>${cursor.workId}::uuid` : sql `true`)).orderBy(asc(trackingState.mediaId)).limit(JELLYFIN_FINALIZATION_BATCH);
        const watchedIds = states.filter(state => state.watched).map(state => state.mediaId);
        // An agreed baseline alone can be stale. Skip seeding watched jobs only
        // when the current scan confirms that every available source is watched.
        // Explicit intents already in the table still go through the enqueue phase.
        const alreadyWatched = new Set(watchedIds.length ? (await tx.execute<{id: string}>(sql`
            select v.media_id as id from sync_values v
            where v.connection_id=${connectionId} and v.category='history'
              and v.media_id=any(${`{${watchedIds.join(',')}}`}::uuid[])
              and not v.conflict and v.agreed='{"value":true}'::jsonb and v.remote=v.agreed
              and exists(select 1 from availability a where a.user_id=${userId} and a.connection_id=v.connection_id
                and a.media_id=v.media_id and a.state='available' and a.scan_id=${scanId})
              and not exists(select 1 from availability a where a.user_id=${userId} and a.connection_id=v.connection_id
                and a.media_id=v.media_id and a.state='available'
                and (a.scan_id is distinct from ${scanId}::uuid or a.source->'coastUserData'->'played' is distinct from 'true'::jsonb))
        `)).map(row => row.id) : []);
        const rows: typeof reconciliationIntents.$inferInsert[] = [];
        for (const state of states) {
            if (state.favourite)
                rows.push({ connectionId, workId: state.mediaId, category: 'favourite', value: { value: true } });
            if (state.watched && !alreadyWatched.has(state.mediaId))
                rows.push({ connectionId, workId: state.mediaId, category: 'history', value: { value: true } });
            if (state.positionSeconds > 0)
                rows.push({ connectionId, workId: state.mediaId, category: 'progress', value: { positionSeconds: state.positionSeconds, durationSeconds: state.durationSeconds ?? 0 } });
        }
        if (rows.length)
            await tx.insert(reconciliationIntents).values(rows).onConflictDoNothing();
        cursor.processed += states.length;
        cursor.workId = states.at(-1)?.mediaId ?? cursor.workId;
        if (states.length < JELLYFIN_FINALIZATION_BATCH) {
            cursor.phase = 'music';
            cursor.workId = null;
        }
    }
    else if (cursor.phase === 'music') {
        const states = await tx.select().from(musicProgress).where(and(eq(musicProgress.userId, userId), cursor.workId ? sql `${musicProgress.trackId}>${cursor.workId}::uuid` : sql `true`)).orderBy(asc(musicProgress.trackId)).limit(JELLYFIN_FINALIZATION_BATCH);
        const rows: typeof reconciliationIntents.$inferInsert[] = [];
        for (const state of states) {
            if (state.playCount > 0)
                rows.push({ connectionId, workId: state.trackId, category: 'history', value: { value: true, playCount: state.playCount } });
            if (state.positionSeconds > 0)
                rows.push({ connectionId, workId: state.trackId, category: 'progress', value: { positionSeconds: state.positionSeconds, durationSeconds: state.durationSeconds ?? 0 } });
        }
        if (rows.length)
            await tx.insert(reconciliationIntents).values(rows).onConflictDoNothing();
        cursor.processed += states.length;
        cursor.workId = states.at(-1)?.trackId ?? cursor.workId;
        if (states.length < JELLYFIN_FINALIZATION_BATCH) {
            cursor.phase = 'enqueue';
            cursor.workId = null;
            cursor.category = null;
        }
    }
    else {
        const intents = await tx.select().from(reconciliationIntents).where(and(eq(reconciliationIntents.connectionId, connectionId), sql `exists(select 1 from availability a where a.connection_id=${connectionId} and a.media_id=${reconciliationIntents.workId} and a.scan_id=${scanId} and a.state='available')`, cursor.workId ? sql `(${reconciliationIntents.workId},${reconciliationIntents.category})>(${cursor.workId}::uuid,${cursor.category}::text)` : sql `true`)).orderBy(asc(reconciliationIntents.workId), asc(reconciliationIntents.category)).limit(JELLYFIN_FINALIZATION_BATCH).for('update');
        for (const intent of intents)
            await enqueueInTransaction(tx, { userId, connectionId, kind: 'jellyfin.reconcile', payload: { mediaId: intent.workId, field: intent.category === 'history' ? 'watched' : intent.category, value: intent.category === 'progress' ? Number(intent.value.positionSeconds) : Boolean(intent.value.value), playCount: intent.value.playCount, durationSeconds: intent.value.durationSeconds, intentVersion: intent.version, backfill: true }, compactionKey: `jellyfin-reconcile:${intent.workId}:${intent.category}` });
        cursor.processed += intents.length;
        if (intents.length) {
            cursor.workId = intents.at(-1)!.workId;
            cursor.category = intents.at(-1)!.category;
        }
        if (intents.length < JELLYFIN_FINALIZATION_BATCH)
            cursor.phase = 'done';
    }
    return cursor;
}
