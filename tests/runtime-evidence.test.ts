import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeEvidence, runtimeErrorCode, runtimeSampleStore } from '../src/lib/server/diagnostics/runtime';
import { DiagnosticStore, storageLimits, diagnosticStore } from '../src/lib/server/diagnostics';
import { safeFields } from '../src/lib/diagnostics';

test('stalled overlapping work stays visible and completion is idempotent', async () => {
  let now = 0;
  const rows: Record<string, unknown>[] = [];
  const evidence = new RuntimeEvidence((_event, fields) => { rows.push(fields); }, async () => ({rssBytes: 42}), () => now);
  const first = evidence.begin('heartbeat'), second = evidence.begin('heartbeat');
  const maintenance = evidence.begin('maintenance'), overlapping = evidence.begin('maintenance');
  now = 61_000;
  await evidence.sample();
  expect(rows.at(-1)).toMatchObject({heartbeatInFlight: 2, heartbeatOverlap: 1, heartbeatBusyMs: 61_000,
    maintenanceInFlight: 2, maintenanceOverlap: 1, rssBytes: 42});
  first(); first(); second(); maintenance(); overlapping();
  expect(evidence.measurements()).toMatchObject({heartbeatInFlight: 0, heartbeatBusyMs: 0, maintenanceInFlight: 0});
});

test('reservation timing preserves result and rejection identity without secret error text', async () => {
  let now = 0;
  const rows: Record<string, unknown>[] = [];
  const evidence = new RuntimeEvidence((_event, fields) => { rows.push(fields); }, async () => ({}), () => now);
  const original = Object.assign(new Error('private title password=SECRET'), {code: 'ERR_POSTGRES_CONNECTION_CLOSED'});
  await expect(evidence.track('reserve', async () => { now = 2000; throw original; })).rejects.toBe(original);
  expect(evidence.measurements()).toMatchObject({reserveInFlight: 0, operationFailures: 1});
  expect(rows[0]).toEqual({stage: 'reserve', durationMs: 2000, errorCode: 'ERR_POSTGRES_CONNECTION_CLOSED', failed: true});
  expect(JSON.stringify(rows)).not.toContain('SECRET');
  expect(await evidence.track('reserve', async () => 7)).toBe(7);
  await expect(evidence.track('queue', () => { throw original; })).rejects.toBe(original);
  expect(evidence.measurements().queueInFlight).toBe(0);
});

test('unknown errors and malformed getters cannot expose arbitrary classifications', () => {
  expect(runtimeErrorCode({code: 'password=SECRET'})).toBe('unknown');
  expect(runtimeErrorCode({code: 'ERR_POSTGRES_SERVER_ERROR', errno: '53300'})).toBe('53300');
  expect(runtimeErrorCode(new Proxy({}, {get() { throw Error('SECRET'); }}))).toBe('unknown');
  expect(safeFields({rssBytes: Infinity, cgroupBytes: -1, errorCode: 'private', phase: 'private', sql: 'SECRET',
    heartbeatInFlight: 2, error: Error('SECRET')})).toEqual({heartbeatInFlight: 2});
});

test('failed sinks cannot change work and operation storms have a bounded event rate', async () => {
  let emitted = 0, now = 0;
  const evidence = new RuntimeEvidence(() => { emitted++; throw Error('unwritable'); }, async () => ({}), () => now);
  for (let i = 0; i < 1000; i++) evidence.begin('queue')(Error('private'));
  expect(emitted).toBe(30);
  expect(evidence.measurements()).toMatchObject({queueInFlight: 0, operationFailures: 1000, runtimeEventsDropped: 970});
  expect(await evidence.track('reserve', async () => 42)).toBe(42);
  now = 60_001;
  evidence.connection({errno: '53300'});
  expect(emitted).toBe(31);
});

test('sampling does not overlap when resource collection stalls, and sink rejection is contained', async () => {
  let calls = 0, now = 0;
  let resolve!: (measurements: Record<string, number>) => void;
  const pending = new Promise<Record<string, number>>(done => { resolve = done; });
  const evidence = new RuntimeEvidence(() => Promise.reject(Error('disk unavailable')), () => { calls++; return pending; }, () => now);
  const first = evidence.sample();
  await evidence.sample(); await evidence.sample();
  expect(calls).toBe(1);
  resolve({rssBytes: 123}); await first; await Promise.resolve();
  now = 60_001;
  await evidence.sample();
  expect(calls).toBe(2);
});

test('slow-operation chatter cannot exhaust the failure-event budget', () => {
  let now = 0;
  const rows: Record<string, unknown>[] = [];
  const evidence = new RuntimeEvidence((_event, fields) => { rows.push(fields); }, async () => ({}), () => now);
  for (let i = 0; i < 100; i++) { const end = evidence.begin('queue'); now += 1001; end(); }
  // Move into one fresh fixed minute and fill only its timing budget.
  now += 60_000;
  for (let i = 0; i < 30; i++) { const end = evidence.begin('queue'); now += 1001; end(); }
  evidence.connection({errno: '53300'});
  expect(rows.at(-1)).toMatchObject({stage: 'connection', errorCode: '53300', failed: true});
});

test('actual structured storage bounds queued writes and counts filesystem failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-runtime-evidence-'));
  const store = new DiagnosticStore(() => directory);
  try {
    await Promise.all(Array.from({length: 1000}, () => store.write('info', 'runtime.sample',
      {rssBytes: 100, error: Error('SECRET'), parameters: ['private']})));
    expect(store.metrics()).toMatchObject({diagnosticPending: 0, diagnosticDropped: 1000 - storageLimits.pending});
    expect((await store.recent()).length).toBeLessThanOrEqual(storageLimits.pending);
    expect(await readFile(join(directory, '0.jsonl'), 'utf8')).not.toContain('SECRET');
    const failed = new DiagnosticStore(() => '/dev/null/unwritable');
    await expect(failed.write('info', 'runtime.sample', {rssBytes: 1})).resolves.toBeUndefined();
    expect(failed.metrics()).toEqual({diagnosticPending: 0, diagnosticDropped: 0, diagnosticFailures: 1});
  } finally { await rm(directory, {recursive: true, force: true}); }
});


test('connection failures include close errors and undefined rejections remain failures', async () => {
  const rows: Record<string, unknown>[] = [];
  const evidence = new RuntimeEvidence((_event, fields) => { rows.push(fields); }, async () => ({}));
  evidence.connection(null);
  evidence.connection({errno: '57P01'}, true);
  expect(evidence.measurements()).toMatchObject({connectionsOpened: 1, connectionsClosed: 1, connectionFailures: 1});
  let rejected = false;
  try { await evidence.track('queue', () => Promise.reject(undefined)); } catch (error) { rejected = true; expect(error).toBeUndefined(); }
  expect(rejected).toBe(true);
  expect(evidence.measurements()).toMatchObject({queueInFlight: 0, operationFailures: 1});
  expect(rows.at(-1)).toMatchObject({stage: 'queue', errorCode: 'unknown', failed: true});
});

test('provider rotation cannot discard resource history, and hot restarts cannot oversample', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-sample-retention-'));
  const previous = process.env.COAST_DATA_DIR;
  const level = diagnosticStore.level;
  let now = 0;
  process.env.COAST_DATA_DIR = directory;
  diagnosticStore.level = 'info';
  try {
    const evidence = new RuntimeEvidence(undefined, async () => ({rssBytes: 42}), () => now);
    await evidence.sample();
    await evidence.sample();
    expect(await runtimeSampleStore.recent()).toHaveLength(1);
    await diagnosticStore.write('info', 'request.complete', {status: 200});
    for (let i = 0; i < 8; i++) {
      await writeFile(join(directory, 'diagnostics', '0.jsonl'), 'x'.repeat(storageLimits.segmentBytes));
      await diagnosticStore.write('info', 'request.complete', {status: 200});
    }
    expect(await runtimeSampleStore.recent()).toHaveLength(1);
    now = 60_001; await evidence.sample();
    expect(await runtimeSampleStore.recent()).toHaveLength(2);
    diagnosticStore.level = 'off';
    now += 60_001; await evidence.sample();
    expect(await runtimeSampleStore.recent()).toHaveLength(2);
  } finally {
    if (previous === undefined) delete process.env.COAST_DATA_DIR; else process.env.COAST_DATA_DIR = previous;
    diagnosticStore.level = level;
    await rm(directory, {recursive: true, force: true});
  }
});
