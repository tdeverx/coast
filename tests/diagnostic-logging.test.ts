import { test, expect } from 'bun:test';
import { mkdtemp, rm, readdir, stat, writeFile, utimes, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enabled, diagnosticLevels, safeFields, correlationId } from '../src/lib/diagnostics';
import { DiagnosticStore, storageLimits, context } from '../src/lib/server/diagnostics';
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
  ).toEqual({ status: 503, durationMs: 1.23, failure: 'network' });
  expect(correlationId('private arbitrary text')).not.toBe('private arbitrary text');
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
test('rotation, retention and bounded pending writes constrain local storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coast-log-'));
  const store = new DiagnosticStore(() => directory);
  try {
    for (let cycle = 0; cycle < 8; cycle++) {
      await writeFile(join(directory, '0.jsonl'), 'x'.repeat(storageLimits.segmentBytes));
      await store.write('info', 'request.complete', { status: 200 });
    }
    expect((await readdir(directory)).length).toBeLessThanOrEqual(storageLimits.segments);
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
