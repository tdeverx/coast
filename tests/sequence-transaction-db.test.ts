import { afterAll, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDb, getDb, getSql, type Database } from '../src/lib/server/db';
import { media, mediaRelationships, trackingState, users } from '../src/lib/server/db/schema';
import { sequenceEntries } from '../src/lib/core/lists/sequence.server';
import { bulkTrackInTransaction, trackInTransaction } from '../src/lib/core/tracking/service.server';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
afterAll(closeDb);

function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Sequence transactions exhausted the pool.')), milliseconds);
  });
  try { return await Promise.race([task, timeout]); }
  finally { clearTimeout(timer!); }
}

for (const mode of ['single', 'bulk', 'bulk-sequence'] as const) {
  run(`${mode} sequence tracking completes with ten occupied same-account connections`, async () => {
    const db = getDb();
    const [owner] = await db.insert(users).values({
      username: `sequence-pool-${crypto.randomUUID()}`,
      passwordHash: 'fixture',
    }).returning();
    const collectionId = crypto.randomUUID();
    const movieId = crypto.randomUUID();
    const held = latch();
    const release = latch();
    const waitersReady = latch();
    const writes: Promise<unknown>[] = [];
    let unrelated: Promise<unknown> | undefined;
    try {
      await db.insert(media).values([
        { id: collectionId, kind: 'collection', title: 'Pool fixture collection' },
        { id: movieId, kind: 'movie', title: 'Pool fixture movie', releaseDate: '2020-01-01' },
      ]);
      await db.insert(mediaRelationships).values({
        parentId: collectionId, childId: movieId, kind: 'collection', position: 0,
      });
      const sequence = { kind: 'collection' as const, id: collectionId, entryId: `${collectionId}/${movieId}` };
      const eventId = crypto.randomUUID();
      const write = (tx: Transaction, index: number) => mode === 'single'
        ? trackInTransaction(tx, owner.id, {
            mediaId: movieId, action: 'watch', sourceEventId: `${eventId}:${index}`, sequence,
          })
        : bulkTrackInTransaction(tx, owner.id, {
            mediaId: collectionId, action: 'watch', onReleaseDate: true,
            ...(mode === 'bulk-sequence' ? { sequence: { ...sequence, entryId: collectionId } } : {}),
          });
      writes.push(db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner.id}, 0))`);
        held.release();
        await release.promise;
        return write(tx, 0);
      }));
      // Observe failures immediately, while the first writer deliberately holds the lock.
      void Promise.allSettled(writes);
      await bounded(held.promise, 5000);
      let acquired = 0;
      for (let index = 1; index < 10; index++) {
        writes.push(db.transaction(async tx => {
          // If the implementation regresses, lock waiters eventually release their slots
          // so failure cleanup remains bounded; successful writes require no cancellation.
          await tx.execute(sql`set local statement_timeout = '8s'`);
          acquired++;
          if (acquired === 9) waitersReady.release();
          return write(tx, index);
        }));
      }
      void Promise.allSettled(writes);
      await bounded(waitersReady.promise, 5000);
      unrelated = getSql()`select 1 as healthy`.then(rows => rows[0].healthy);
      release.release();
      const results = await bounded(Promise.all([...writes, unrelated]), 5000);
      expect(results.at(-1)).toBe(1);
      const [state] = await db.select().from(trackingState).where(
        sql`${trackingState.userId} = ${owner.id} and ${trackingState.mediaId} = ${movieId}`
      );
      expect(state.watched).toBe(true);
      expect(state.playCount).toBe(1);
      if (mode === 'single') {
        const duplicate = await db.transaction(tx => trackInTransaction(tx, owner.id, {
          mediaId: movieId, action: 'watch', sourceEventId: `${eventId}:0`, sequence,
        }));
        expect(duplicate).toMatchObject({ duplicate: true, changed: false });
      }
      const entries = await sequenceEntries(owner.id, { kind: 'collection', id: collectionId });
      expect(entries).toMatchObject([{ mediaId: movieId, watched: true }]);
    } finally {
      release.release();
      await Promise.allSettled([...writes, ...(unrelated ? [unrelated] : [])]);
      await db.delete(users).where(eq(users.id, owner.id));
      await db.delete(media).where(inArray(media.id, [collectionId, movieId]));
    }
  }, 20_000);
}

run('sequence reads share the caller transaction and see its uncommitted collection', async () => {
  const db = getDb();
  const [owner] = await db.insert(users).values({
    username: `sequence-visibility-${crypto.randomUUID()}`, passwordHash: 'fixture',
  }).returning();
  const collectionId = crypto.randomUUID();
  const movieId = crypto.randomUUID();
  try {
    await db.transaction(async tx => {
      await tx.insert(media).values([
        { id: collectionId, kind: 'collection', title: 'Uncommitted collection' },
        { id: movieId, kind: 'movie', title: 'Uncommitted movie' },
      ]);
      await tx.insert(mediaRelationships).values({
        parentId: collectionId, childId: movieId, kind: 'collection', position: 0,
      });
      expect(await sequenceEntries(owner.id, { kind: 'collection', id: collectionId }, tx))
        .toMatchObject([{ mediaId: movieId, watched: false }]);
    });
  } finally {
    await db.delete(users).where(eq(users.id, owner.id));
    await db.delete(media).where(inArray(media.id, [collectionId, movieId]));
  }
});
