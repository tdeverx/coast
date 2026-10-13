import {expect, test} from 'bun:test';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {auditLimits, RuntimeAudit, migrationFingerprint, safeAuditFields} from '../scripts/runtime-audit';

test('shutdown escalation accepts only fixed stage, child and signal values', () => {
  expect(safeAuditFields({stage:'kill',child:'database',signal:'KILL',exitCode:143,sql:'PRIVATE',token:'PRIVATE'}))
    .toEqual({stage:'kill',child:'database',signal:'KILL',exitCode:143});
  expect(safeAuditFields({stage:'PRIVATE',child:'PRIVATE',signal:'PRIVATE'})).toEqual({});
});

test('migration audit retains only source checksums and closed runtime metadata outside PostgreSQL', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'coast-audit-'));
  try {
    const audit = new RuntimeAudit(directory);
    const fingerprint = await migrationFingerprint('drizzle');
    expect(fingerprint.migrationCount).toBeGreaterThan(0);
    expect(fingerprint.migrationsSha256).toMatch(/^[a-f0-9]{64}$/);
    await audit.write('migration.start', {...fingerprint, bunVersion: '1.4.3', postgresVersion: '15.19',
      build: 'a'.repeat(40), error: Error('PRIVATE SQL'), token: 'PRIVATE TOKEN', url: 'PRIVATE URL'});
    const path = join(directory, 'runtime', 'migrations.jsonl');
    const text = await fs.readFile(path, 'utf8');
    expect(text).not.toContain('PRIVATE');
    expect(JSON.parse(text).detail).toMatchObject({...fingerprint, bunVersion: '1.4.3', postgresVersion: '15.19'});
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(join(directory, 'runtime'))).mode & 0o777).toBe(0o700);
    await fs.writeFile(path, 'x'.repeat(auditLimits.segmentBytes));
    await audit.write('migration.failed', {durationMs: 10});
    expect((await fs.stat(path + '.1')).size).toBe(auditLimits.segmentBytes);
    expect((await fs.stat(path)).size).toBeLessThan(auditLimits.segmentBytes);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('disk-full and malformed inputs cannot replace a migration result', async () => {
  const audit = new RuntimeAudit('/unused', {...fs,
    mkdir: (async () => undefined) as typeof fs.mkdir,
    chmod: async () => {},
    appendFile: async () => { throw Object.assign(Error('PRIVATE'), {code: 'ENOSPC'}); },
  });
  await expect(audit.write('migration.failed', {pid: 1})).resolves.toBeUndefined();
  await expect(audit.write('migration.failed', new Proxy({}, {get() { throw Error('PRIVATE'); }}))).resolves.toBeUndefined();
});

test('stalled storage has bounded queued work and a bounded caller wait', async () => {
  let release!: () => void, calls = 0, writes = 0;
  const stalled = new Promise<void>(done => { release = done; });
  const audit = new RuntimeAudit('/unused', {...fs,
    mkdir: (async () => { if (++calls === 1) await stalled; }) as typeof fs.mkdir,
    chmod: async () => {},
    appendFile: async () => { writes++; },
  });
  const started = performance.now();
  await Promise.all(Array.from({length: 1000}, () => audit.write('migration.start', {})));
  expect(performance.now() - started).toBeLessThan(2000);
  expect(calls).toBe(1);
  release();
  for (let i = 0; i < 100 && writes < auditLimits.pending; i++) await Bun.sleep(1);
  expect(writes).toBe(auditLimits.pending);
});

test('a failed connection still leaves source-audit start and failure records', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'coast-audit-migrate-'));
  try {
    const env: Record<string, string | undefined> = {...process.env, COAST_DATA_DIR: directory};
    delete env.DATABASE_URL; delete env.TEST_DATABASE_URL;
    const child = Bun.spawn([process.execPath, 'scripts/migrate.ts'], {env, stdout: 'ignore', stderr: 'ignore'});
    expect(await child.exited).toBe(1);
    const rows = (await fs.readFile(join(directory, 'runtime', 'migrations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(rows.map(row => row.kind)).toEqual(['migration.start', 'migration.failed']);
    expect(rows[0].detail.migrationsSha256).toMatch(/^[a-f0-9]{64}$/);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});
