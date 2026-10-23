// Supplementary authored CI fixture. Real catalogue acceptance is recorded by
// scripts/performance-followup.ts and performance-finalization.ts separately.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, closeDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { reconcileJellyfinBatch, type FinalizationCursor } from '../src/lib/sync/jellyfin-finalization.server';
const enabled = process.env.COAST_DB_TEST === '1', run = enabled ? test : test.skip;
const owner = crypto.randomUUID(), instance = crypto.randomUUID(), connection = crypto.randomUUID(), scan = crypto.randomUUID();
const ids = Array.from({ length: 105 }, () => crypto.randomUUID()).sort();
beforeAll(async () => {
    if (!enabled)
        return;
    const db = getDb();
    await db.insert(s.users).values({ id: owner, username: `finalization-${owner}` });
    await db.insert(s.providerInstances).values({ id: instance, provider: 'jellyfin', name: 'Finalization CI fixture', baseUrl: 'https://fixture.invalid' });
    await db.insert(s.providerConnections).values({ id: connection, userId: owner, instanceId: instance, externalUserId: 'fixture' });
    await db.insert(s.media).values(ids.map(id => ({ id, kind: 'movie' as const, title: 'CI finalization boundary' })));
    await db.insert(s.trackingState).values(ids.map(mediaId => ({ userId: owner, mediaId, watched: true, playCount: 1 })));
    const items = await db.insert(s.providerItems).values(ids.map(id => ({ instanceId: instance, mediaId: id, externalId: id, kind: 'movie' as const }))).returning();
    await db.insert(s.availability).values(items.map(item => ({ userId: owner, connectionId: connection, providerItemId: item.id, mediaId: item.mediaId!, state: 'available' as const, scanId: scan })));
});
afterAll(async () => {
    if (!enabled)
        return;
    await getDb().delete(s.users).where(eq(s.users.id, owner));
    await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id, instance));
    await getDb().delete(s.media).where(inArray(s.media.id, ids));
    await closeDb();
});
run('finalization bounds each native batch and rolls back effects before replaying its cursor', async () => {
    const db = getDb();
    let cursor: FinalizationCursor = { phase: 'screen', workId: null, category: null, processed: 0 };
    await expect(db.transaction(async (tx) => {
        await reconcileJellyfinBatch(tx, owner, connection, scan, cursor);
        throw Error('rollback boundary');
    })).rejects.toThrow('rollback boundary');
    expect(await db.select().from(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId, connection))).toHaveLength(0);
    expect(cursor).toEqual({ phase: 'screen', workId: null, category: null, processed: 0 });
    const sizes: number[] = [];
    while (cursor.phase !== 'done') {
        const next = await db.transaction(tx => reconcileJellyfinBatch(tx, owner, connection, scan, cursor));
        sizes.push(next.processed - cursor.processed);
        expect(next.processed - cursor.processed).toBeLessThanOrEqual(100);
        cursor = next;
        expect(sizes.length).toBeLessThan(10);
    }
    expect(sizes).toEqual([100, 5, 0, 100, 5]);
    const intents = await db.select().from(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId, connection));
    expect(intents.map(row => row.workId).sort()).toEqual(ids);
    expect(intents.every(row => row.category === 'history' && row.value.value === true)).toBe(true);
    const jobs = await db.select().from(s.outboxActions).where(and(eq(s.outboxActions.connectionId, connection), eq(s.outboxActions.state, 'pending')));
    expect(jobs).toHaveLength(105);
    expect(jobs.every(job => intents.some(intent => intent.workId === job.payload.mediaId && intent.version === job.payload.intentVersion))).toBe(true);
    expect(await db.transaction(tx => reconcileJellyfinBatch(tx, owner, connection, scan, cursor))).toEqual(cursor);
    expect(await db.select().from(s.outboxActions).where(eq(s.outboxActions.connectionId, connection))).toHaveLength(105);
});
