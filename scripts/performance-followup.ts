/** Controlled native acceptance only. Run against a marked disposable restore,
 * never the source database. Does not fabricate accounts/catalogue/provider replies. */
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { changeContinue } from '../src/lib/core/tracking/continue.server';
import { track } from '../src/lib/core/tracking/service.server';
import { setUpNext } from '../src/lib/core/lists/up-next.server';
import { progressExperimentData } from '../src/lib/server/queries/progress-experiment';
import { reconcileJellyfinBatch, JELLYFIN_FINALIZATION_BATCH, type FinalizationCursor } from '../src/lib/sync/jellyfin-finalization.server';
import { enqueueSyncValueInTransaction } from '../src/lib/sync/changes.server';
import { withReadCancellation } from '../src/lib/server/db/read-cancellation';
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
const prefix = 'coast_audit_followup_', name = url.pathname.slice(1), marker = process.env.COAST_AUDIT_COPY_MARKER;
if (!/^coast_audit_followup_[a-f0-9]{32}$/.test(name) || marker !== `coast-performance-followup:${name.slice(prefix.length)}`)
    throw Error('A run-marked disposable actual-data restore is required.');
const db = getDb(), client = getSql(), checks: {
    name: string;
    passed: boolean;
}[] = [], metrics: Record<string, unknown> = {};
const canonical = (value: any): any => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const check = (value: unknown, name: string) => {
    checks.push({ name, passed: !!value });
    if (!value) throw Error(name);
};
const latch = () => {
    let release!: () => void;
    return { promise: new Promise<void>(r => release = r), release };
};
let external = 0, completed = false;
const failures: {
    name: string;
    code?: string;
}[] = [];
globalThis.fetch = (async () => {
    external++;
    throw Error('External transport disabled in native-copy acceptance.');
}) as typeof fetch;
const original = db.transaction.bind(db);
try {
    const [ownership] = await client `select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()`;
    check(ownership.marker === marker, 'exact-database-copy-marker');
    const [admin] = await client `select id from users where username='admin' and role='admin' and not disabled`;
    check(admin, 'existing-admin');
    const [catalogue] = await client `select count(*)::int total from works`;
    metrics.catalogueWorks = catalogue.total;
    const targets = await client `select id from media m where kind='movie'
    and not exists(select 1 from tracking_events where user_id=${admin.id} and media_id=m.id)
    and not exists(select 1 from tracking_state where user_id=${admin.id} and media_id=m.id)
    and not exists(select 1 from up_next where user_id=${admin.id} and media_id=m.id) order by id limit 3`;
    check(targets.length === 3, 'three-existing-untracked-movies');
    const queue = [];
    for (const target of targets) {
        const entered = latch(), release = latch();
        let first = true, ownerPid = 0, peerPid = 0;
        const before = await client `select media_id,created_at from up_next where user_id=${admin.id} order by created_at,media_id`;
        (db as any).transaction = (fn: any) => original(async (tx) => {
            await tx.execute(sql `set local statement_timeout='8s'`);
            const [{ pid }] = await tx.execute<{
                pid: number;
            }>(sql `select pg_backend_pid() pid`);
            const owner = first;
            first = false;
            if (owner)
                ownerPid = pid;
            else
                peerPid = pid;
            if (owner) {
                const select = tx.select.bind(tx);
                (tx as any).select = (...args: any[]) => {
                    const b = select(...args), from = b.from.bind(b);
                    b.from = (table: any) => {
                        const builder = from(table);
                        if (table !== s.upNext)
                            return builder;
                        const where = builder.where.bind(builder);
                        builder.where = (cond: any) => {
                            const query = where(cond), then = query.then.bind(query);
                            query.then = (ok: any, bad: any) => then(async (rows: any) => {
                                entered.release();
                                await release.promise;
                                return ok ? ok(rows) : rows;
                            }, bad);
                            return query;
                        };
                        return builder;
                    };
                    return b;
                };
            }
            return fn(tx);
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const removal = changeContinue(admin.id, { mediaId: target.id, action: 'remove' });
            timer = setTimeout(() => release.release(), 3000);
            await entered.promise;
            const peer = setUpNext(admin.id, { mediaId: target.id, queued: true });
            let blocked = false;
            for (let i = 0; i < 50 && !blocked; i++) {
                if (peerPid) {
                    const [row] = await client `select ${ownerPid}=any(pg_blocking_pids(${peerPid})) blocked`;
                    blocked = row.blocked;
                }
                if (!blocked)
                    await Bun.sleep(10);
            }
            release.release();
            const removed: any = await removal;
            await peer;
            (db as any).transaction = original;
            check(ownerPid !== peerPid && blocked, 'concurrent-native-enqueue-waits-for-removal');
            const [later] = await client `select created_at from up_next where user_id=${admin.id} and media_id=${target.id}`;
            check(later && removed.previous.queued.length === 0, 'later-enqueue-survives-removal');
            await changeContinue(admin.id, { mediaId: target.id, action: 'undo', eventId: removed.eventId, previous: removed.previous });
            const [after] = await client `select created_at from up_next where user_id=${admin.id} and media_id=${target.id}`;
            check(after?.created_at.getTime() === later.created_at.getTime(), 'undo-preserves-later-enqueue-timestamp');
            await setUpNext(admin.id, { mediaId: target.id, queued: false });
            const remaining = await client `select media_id,created_at from up_next where user_id=${admin.id} order by created_at,media_id`;
            check(hash(remaining) === hash(before), 'unrelated-queue-order-and-timestamps-preserved');
            queue.push({ blocked, laterIntentSurvivedUndo: true });
        }
        finally {
            clearTimeout(timer);
            release.release();
            (db as any).transaction = original;
        }
    }
    metrics.queue = queue;
    // Cancellation uses the real Progress planner. The independent catalogue read
    // adds only a controlled server delay, not fabricated content or provider data.
    const cancellation = [];
    for (let i = 0; i < 3; i++) {
        const controller = new AbortController();
        let at = 0;
        const independent = db.execute<{
            n: number;
        }>(sql `select (select count(*)::int from works) n,pg_sleep(0.15)`);
        const pending = progressExperimentData(admin.id, { category: 'screen' }, { preview: true, signal: controller.signal });
        const timer = setTimeout(() => {
            at = performance.now();
            controller.abort();
        }, 30);
        let aborted = false;
        try {
            await pending;
        }
        catch (e) {
            aborted = e instanceof Error && e.name === 'AbortError';
        }
        finally {
            clearTimeout(timer);
        }
        const settled = performance.now() - at;
        const unaffected = await independent;
        check(aborted && unaffected[0].n === catalogue.total, 'abort-cancels-only-owned-query-handles');
        const [healthy] = await db.execute<{
            ok: number;
        }>(sql `select 1 ok`);
        check(healthy.ok === 1, 'pool-reusable-after-cancelled-read');
        cancellation.push({ abortToSettleMs: settled, unrelatedReadPreserved: true });
    }
    let admitted = false;
    const stopped = new AbortController();
    stopped.abort();
    try {
        await withReadCancellation(stopped.signal, async () => { admitted = true; });
    }
    catch { }
    check(!admitted, 'pre-aborted-read-never-admitted');
    metrics.cancellation = cancellation;
    // Retain only existing natural state over existing catalogue IDs on this copy.
    const [account] = await client `select c.id from provider_connections c join provider_instances i on i.id=c.instance_id
    where c.user_id=${admin.id} and c.status='connected' and i.provider='jellyfin' and i.enabled order by c.id limit 1`;
    check(account, 'existing-jellyfin-account');
    let states = await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId, admin.id), sql `(${s.trackingState.watched} or ${s.trackingState.favourite} or ${s.trackingState.positionSeconds}>0)`)).orderBy(s.trackingState.mediaId).limit(105);
    const existingPositiveRowsAtStart = states.length;
    let controlledMovieCommands = 0;
    if (states.length < 105 && process.env.COAST_AUDIT_CONTROLLED_TRACKING === '1') {
        const movies = await client `select distinct m.id from media m join availability a on a.media_id=m.id
      where m.kind='movie' and a.user_id=${admin.id} and a.connection_id=${account.id} and a.state='available'
        and not exists(select 1 from tracking_state t where t.user_id=${admin.id} and t.media_id=m.id and (t.watched or t.favourite or t.position_seconds>0))
      order by m.id limit ${105 - states.length}`;
        for (const movie of movies) {
            await track(admin.id, { mediaId: movie.id, action: 'watch', acknowledged: true });
            controlledMovieCommands++;
        }
        states = await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId, admin.id), sql `(${s.trackingState.watched} or ${s.trackingState.favourite} or ${s.trackingState.positionSeconds}>0)`)).orderBy(s.trackingState.mediaId).limit(105);
    }
    check(states.length === 105, 'actual-tracking-state-crosses-100-row-boundary');
    const music = await db.select().from(s.musicProgress).where(eq(s.musicProgress.userId, admin.id)).orderBy(s.musicProgress.trackId).limit(20);
    const selected = states.map(r => r.mediaId), expected = new Map<string, unknown>();
    for (const state of states) {
        if (state.favourite)
            expected.set(state.mediaId + ':favourite', { value: true });
        if (state.watched)
            expected.set(state.mediaId + ':history', { value: true });
        if (state.positionSeconds > 0)
            expected.set(state.mediaId + ':progress', { positionSeconds: state.positionSeconds, durationSeconds: state.durationSeconds ?? 0 });
    }
    for (const state of music) {
        if (state.playCount > 0 && !expected.has(state.trackId + ':history'))
            expected.set(state.trackId + ':history', { value: true, playCount: state.playCount });
        if (state.positionSeconds > 0 && !expected.has(state.trackId + ':progress'))
            expected.set(state.trackId + ':progress', { positionSeconds: state.positionSeconds, durationSeconds: state.durationSeconds ?? 0 });
    }
    await db.delete(s.trackingState).where(and(eq(s.trackingState.userId, admin.id), sql `not (${s.trackingState.mediaId}=any(${`{${selected.join(',')}}`}::uuid[]))`));
    if (music.length)
        await db.delete(s.musicProgress).where(and(eq(s.musicProgress.userId, admin.id), sql `not (${s.musicProgress.trackId}=any(${`{${music.map(r => r.trackId).join(',')}}`}::uuid[]))`));
    await db.delete(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId, account.id));
    await db.delete(s.outboxActions).where(and(eq(s.outboxActions.connectionId, account.id), inArray(s.outboxActions.kind, ['jellyfin.reconcile', 'jellyfin.user-state'])));
    const scanId = crypto.randomUUID();
    await db.update(s.availability).set({ scanId }).where(eq(s.availability.connectionId, account.id));
    let cursor: FinalizationCursor = { phase: 'screen', workId: null, category: null, processed: 0 };
    const steps = [];
    let concurrentIntentChecked = false;
    const manualWork = states[0].mediaId;
    // Rollback must undo both the batch and its cursor, then replay the same input.
    try {
        await db.transaction(async (tx) => {
            await reconcileJellyfinBatch(tx, admin.id, account.id, scanId, cursor);
            throw Error('owned-rollback-control');
        });
    }
    catch (e) {
        if (!(e instanceof Error) || e.message !== 'owned-rollback-control')
            throw e;
    }
    check((await db.select().from(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId, account.id))).length === 0, 'rolled-back-batch-publishes-no-intents');
    while (cursor.phase !== 'done') {
        const next = await db.transaction(async (tx) => {
            await tx.select({ id: s.providerConnections.id }).from(s.providerConnections).where(eq(s.providerConnections.id, account.id)).for('no key update');
            if (cursor.phase === 'enqueue' && !concurrentIntentChecked) {
                // The finalizer holds its native account fence. A genuine competing
                // writer must still acquire the connection FK key-share and commit.
                let timeout: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        db.transaction(peer => enqueueSyncValueInTransaction(peer, admin.id, manualWork, 'favourite', { value: false })),
                        new Promise<never>((_, reject) => timeout = setTimeout(() => reject(Error('native-writer-blocked-by-account-fence')), 1500)),
                    ]);
                }
                finally {
                    clearTimeout(timeout);
                }
                expected.set(manualWork + ':favourite', { value: false });
                concurrentIntentChecked = true;
            }
            const next = await reconcileJellyfinBatch(tx, admin.id, account.id, scanId, cursor);
            await tx.execute(sql `update provider_connections set settings=jsonb_set(settings,'{userSync}',${{ phase: 'finalizing', finalizationPhase: next.phase, finalizationCursor: next.workId, finalizationCategory: next.category, stageProcessed: next.processed }}::jsonb) where id=${account.id}`);
            return next;
        });
        check(next.processed - cursor.processed <= JELLYFIN_FINALIZATION_BATCH, 'batch-selection-at-most-100');
        steps.push({ phase: cursor.phase, selected: next.processed - cursor.processed });
        cursor = next;
        check(steps.length < 20, 'finite-native-finalization');
    }
    check(concurrentIntentChecked, 'manual-intent-writer-commits-while-finalizer-holds-account-fence');
    const actual = await db.select().from(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId, account.id));
    const entries = (map: Map<string, unknown>) => [...map].sort(([a], [b]) => a.localeCompare(b));
    check(hash(entries(new Map(actual.map(r => [r.workId + ':' + r.category, r.value])))) === hash(entries(expected)), 'complete-actual-intent-values-match-independent-reference');
    const pending = await db.select().from(s.outboxActions).where(and(eq(s.outboxActions.connectionId, account.id), eq(s.outboxActions.kind, 'jellyfin.reconcile'), eq(s.outboxActions.state, 'pending')));
    const available = new Set((await db.select({ id: s.availability.mediaId }).from(s.availability).where(and(eq(s.availability.connectionId, account.id), eq(s.availability.state, 'available'), eq(s.availability.scanId, scanId)))).map(r => r.id));
    check(pending.length === actual.filter(r => available.has(r.workId)).length, 'exact-mapped-intent-count-enqueued');
    check(pending.every(job => actual.some(r => r.version === job.payload.intentVersion && r.workId === job.payload.mediaId)), 'backfills-use-current-intent-versions');
    metrics.finalization = { actualScreenRows: states.length, existingPositiveRowsAtStart, controlledMovieCommands, existingMusicRows: music.length, intents: actual.length, pending: pending.length, steps };
    check(external === 0, 'zero-external-provider-requests');
    completed = true;
}
catch (error) {
    const e = error as Error & {
        code?: string;
    };
    failures.push({ name: e.name, code: e.code });
    throw error;
}
finally {
    (db as any).transaction = original;
    try {
        await closeDb();
    }
    catch (error) {
        completed = false;
        failures.push({ name: 'cleanup-failed' });
    }
    await writeFile(process.argv[2] ?? '/tmp/coast-performance-followup.json', JSON.stringify({ status: completed ? 'passed' : 'failed', failures, sourceRef: process.env.COAST_AUDIT_SOURCE_REF ?? 'unrecorded', executableSha256: createHash('sha256').update(await Bun.file(process.argv[1]).bytes()).digest('hex'), boundary: 'Controlled existing admin/catalogue state on marked disposable actual-data copy; no fabricated identities or provider responses', runtime: Bun.version, revision: Bun.revision, checks, metrics, external }, null, 2) + '\n', { mode: 0o600 });
}
