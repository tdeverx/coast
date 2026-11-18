import { test, expect } from 'bun:test';
import { mkdtemp, rm, readdir, stat, writeFile, utimes, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enabled, diagnosticLevels, browserDiagnosticLevels, safeFields, correlationId } from '../src/lib/diagnostics';
import { DiagnosticStore, storageLimits, context, diagnosticRequest, classifyFailure, diagnosticErrorCode } from '../src/lib/server/diagnostics';
import { requestDiagnostics, requestDiagnosticLevel } from '../src/lib/server/diagnostics/request';
import { ProviderQueueBusyError, ProviderQueueTimeoutError } from '../src/lib/server/security/request-priority';
import { listDiagnostics } from '../src/lib/server/notifications';
import { defaultConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';

test('all levels filter in order, with verbose events disabled by default', () => {
  for (const threshold of diagnosticLevels)
    for (const level of diagnosticLevels)
      expect(enabled(level, threshold)).toBe(
        level !== 'off' &&
          threshold !== 'off' &&
          diagnosticLevels.indexOf(level) <= diagnosticLevels.indexOf(threshold)
      );
  expect(defaultConfig.diagnosticLevel).toBe('info');
});
test('safe fields discard secrets, personal data, URLs, bodies and raw exceptions', () => {
  expect(
    safeFields({
      status: 503,
      durationMs: 1.234,
      failure: 'network',
      operation: 'collection',
      stage: 'card-hydration',
      sql: 'select private data',
      parameters: ['private title'],
      token: 'SECRET',
      cookie: 'SECRET',
      body: { password: 'SECRET' },
      url: 'https://private/path',
      userId: crypto.randomUUID(),
      email: 'someone@example.com',
      error: new Error('SECRET'),
      method: 'SECRET',
      sessionId: 'SECRET',
      code: Infinity,
      positionSeconds: -1,
    })
  ).toEqual({ status: 503, durationMs: 1.23, failure: 'network', operation: 'collection', stage: 'card-hydration' });
  expect(correlationId('private arbitrary text')).not.toBe('private arbitrary text');
});
test('local provider admission pressure is logged distinctly from provider failures', () => {
  expect(classifyFailure(new ProviderQueueBusyError())).toBe('local-busy');
  expect(classifyFailure(new ProviderQueueTimeoutError())).toBe('local-queue-timeout');
  expect(safeFields({failure:'local-busy',errorCode:'local.provider-busy',message:'private request'}))
    .toEqual({failure:'local-busy',errorCode:'local.provider-busy'});
});
test('normal playback traffic stays quiet at Info while slow requests and failures retain safe context', () => {
  const route = (path: string) => requestDiagnostics(new URL(path, 'https://fixture.invalid'));
  expect(route('/api/v1/playback/PRIVATE/stream?token=SECRET')).toEqual({ operation: 'playback', requestAction: 'stream' });
  expect(route('/api/share/external/PRIVATE/stream.m3u8')).toEqual({ operation: 'playback', requestAction: 'share-stream', surface:'share' });
  expect(route('/api/share/reading/PRIVATE/manifest')).toEqual({ operation: 'reading', requestAction: 'reader-manifest', surface:'share' });
  expect(route('/api/v1/reading/sessions/PRIVATE/pages/1')).toEqual({ operation: 'reading', requestAction: 'reader-page' });
  expect(route('/api/public/v1/progress?SECRET')).toEqual({ operation: 'progress', surface:'public-api' });
  expect(route('/api/v1/playback/PRIVATE')).toEqual({ operation: 'playback', requestAction: 'restore' });
  expect(route('/api/v1/media/details?href=PRIVATE&enhance=true')).toEqual({ operation: 'media', requestAction: 'details-enhance' });
  expect(route('/_app/immutable/PRIVATE.js')).toEqual({ operation: 'other', requestAction: 'asset' });
  expect(requestDiagnosticLevel(206, 35, 'stream')).toBe('debug');
  expect(requestDiagnosticLevel(200, 1100, 'stream')).toBe('info');
  expect(requestDiagnosticLevel(499, 1100, 'stream')).toBe('debug');
  expect(requestDiagnosticLevel(404, 35, 'details')).toBe('info');
  expect(requestDiagnosticLevel(404, 35, 'asset')).toBe('warn');
  expect(requestDiagnosticLevel(429, 35, 'stream')).toBe('warn');
  expect(requestDiagnosticLevel(502, 35, 'stream')).toBe('error');
  expect(browserDiagnosticLevels['playback.playing']).toBe('info');
});
test('diagnostics retain only known browser, job and database categories', () => {
  const cause = Object.assign(new Error('PRIVATE SQL'), { code: 'ERR_POSTGRES_SERVER_ERROR', errno: '23505' });
  expect(diagnosticErrorCode(new Error('PRIVATE PARAMETERS', { cause }))).toBe('23505');
  expect(diagnosticErrorCode({code:'ENOSPC'})).toBe('ENOSPC');
  expect(diagnosticErrorCode({code:'PRIVATE'})).toBeUndefined();
  expect(safeFields({jobKind:'jellyfin.reconcile',browserSource:'script',browserError:'TypeError',
    errorCode:diagnosticErrorCode(cause),playbackChange:'reconfigure',providerWaitMs:12.5})).toEqual({
    jobKind:'jellyfin.reconcile',browserSource:'script',browserError:'TypeError',
    errorCode:'23505',playbackChange:'reconfigure',providerWaitMs:12.5,
  });
  expect(safeFields({jobKind:'PRIVATE',browserSource:'PRIVATE',browserError:'PRIVATE',
    requestAction:'PRIVATE',mediaType:'PRIVATE',delivery:'PRIVATE',errorCode:'PRIVATE'})).toEqual({});
});
test('diagnostic reads and configuration updates require an administrator before IO', async () => {
  const member = {
    id: crypto.randomUUID(),
    username: 'tester',
    email: null,
    role: 'user' as const,
    settings: {},
  };
  await expect(listDiagnostics(null)).rejects.toThrow();
  await expect(listDiagnostics(member)).rejects.toThrow('Administrator');
  await expect(updateConfig(member, defaultConfig)).rejects.toThrow('Administrator');
});
test('runtime level changes, asynchronous context and redaction reach stored events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-log-'));
  const store = new DiagnosticStore(() => directory);
  try {
    const id = crypto.randomUUID();
    await store.write('debug', 'job.start');
    expect(await store.recent()).toHaveLength(0);
    store.level = 'trace';
    await context.run(id, async () => {
      await Promise.resolve();
      await store.write('trace', 'playback.timing', { positionSeconds: 3, password: 'SECRET' });
    });
    const [row] = await store.recent();
    expect(row.correlationId).toBe(id);
    expect(row.detail).toEqual({ positionSeconds: 3 });
    store.level = 'off';
    await store.write('error', 'browser.error');
    expect(await store.recent()).toHaveLength(1);
    expect(await readFile(join(directory, '0.jsonl'), 'utf8')).not.toContain('SECRET');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('overlapping requests in the same browser retain their own server-issued IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-log-requests-'));
  const store = new DiagnosticStore(() => directory);
  try {
    const tab = crypto.randomUUID(), first = crypto.randomUUID(), second = crypto.randomUUID();
    await context.run(tab, () => Promise.all([
      diagnosticRequest.run(first, async () => {
        await Promise.resolve();
        await store.write('info', 'provider.complete', { provider: 'jellyfin', status: 201, requestId: 'spoofed' });
      }),
      diagnosticRequest.run(second, async () => {
        await Promise.resolve();
        await store.write('info', 'provider.complete', { provider: 'jellyfin', status: 202 });
      }),
    ]));
    const rows = await store.recent();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.correlationId === tab)).toBe(true);
    expect(rows.find(row => row.detail.status === 201)?.requestId).toBe(first);
    expect(rows.find(row => row.detail.status === 202)?.requestId).toBe(second);
    expect(JSON.stringify(rows)).not.toContain('spoofed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('a saturated Trace queue still admits warning and error events within the existing cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-log-priority-'));
  const store = new DiagnosticStore(() => directory);
  store.level = 'trace';
  try {
    const routine = Array.from({ length: storageLimits.pending }, () => store.write('trace', 'provider.start'));
    const warnings = Array.from({ length: storageLimits.pending }, () => store.write('warn', 'provider.failed'));
    const errors = Array.from({ length: storageLimits.pending }, () => store.write('error', 'request.failed'));
    expect(store.metrics().diagnosticPending).toBe(storageLimits.pending);
    await Promise.all([...routine, ...warnings, ...errors]);
    const rows = await store.recent();
    expect(rows.filter(row => row.level === 'trace')).toHaveLength(storageLimits.pending - storageLimits.warningReserve);
    expect(rows.filter(row => row.level === 'warn')).toHaveLength(storageLimits.warningReserve - storageLimits.errorReserve);
    expect(rows.filter(row => row.level === 'error')).toHaveLength(storageLimits.errorReserve);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('rotation, retention and bounded pending writes constrain local storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-log-'));
  const store = new DiagnosticStore(() => directory);
  store.configure({maxSizeMiB: 4, maxAgeDays: 7});
  try {
    for (let cycle = 0; cycle < 8; cycle++) {
      await writeFile(join(directory, '0.jsonl'), 'x'.repeat(storageLimits.segmentBytes));
      await store.write('info', 'request.complete', { status: 200 });
    }
    expect((await readdir(directory)).length).toBeLessThanOrEqual(4);
    for (const file of await readdir(directory))
      expect((await stat(join(directory, file))).size).toBeLessThanOrEqual(
        storageLimits.segmentBytes
      );
    await Promise.all(Array.from({ length: 1000 }, () => store.write('info', 'request.complete')));
    expect((await store.recent()).length).toBeLessThanOrEqual(storageLimits.pending + 1);
    const old = new Date(Date.now() - storageLimits.retentionMs - 1000);
    for (const file of await readdir(directory)) await utimes(join(directory, file), old, old);
    expect(await store.recent()).toHaveLength(0);
    expect(await readdir(directory)).toHaveLength(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('filesystem failures and malformed fields cannot interrupt application behavior', async () => {
  const store = new DiagnosticStore(() => '/dev/null/unwritable');
  await expect(store.write('error', 'application.failed')).resolves.toBeUndefined();
  expect(await store.recent()).toEqual([]);
  await expect(
    store.write(
      'error',
      'application.failed',
      new Proxy(
        {},
        {
          get() {
            throw new Error('secret');
          },
        }
      )
    )
  ).resolves.toBeUndefined();
});
