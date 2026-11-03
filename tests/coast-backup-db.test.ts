import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureBackup, pruneBackups, recipientCertificate } from '../src/lib/backups/archive.server';
import { closeDb, getSql } from '../src/lib/server/db';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;

run('Coast publishes an encrypted database and app archive that restore together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coast-backup-test-'));
  const data = join(root, 'data');
  const database = getSql();
  const url = new URL(process.env.DATABASE_URL!);
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    PGHOST: url.searchParams.get('host') ?? url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '2',
  };
  const restoredName = 'coast_backup_test_' + crypto.randomUUID().replaceAll('-', '');
  const certificate = join(root, 'cert.pem');
  const key = join(root, 'key.pem');
  let restored: Bun.SQL | undefined;
  let created = false;
  const command = async (args: string[]) => {
    const process = Bun.spawn(args, { env, stderr: 'pipe', stdout: 'pipe', signal: AbortSignal.timeout(15_000) });
    const [output, errors, exit] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    if (exit) throw new Error(`${args[0]} failed: ${errors}`);
    return output;
  };
  try {
    await mkdir(join(data, 'secrets'), { recursive: true });
    await mkdir(join(data, 'avatars'));
    await writeFile(join(data, 'secrets', 'credentials.key'), 'fixture key bytes');
    await writeFile(join(data, 'avatars', 'profile.png'), 'fixture avatar bytes');
    await database`create table coast_backup_fixture (value text not null)`;
    await database`insert into coast_backup_fixture values ('fixture row')`;
    await command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-subj', '/CN=Coast Backup Fixture', '-keyout', key, '-out', certificate, '-days', '1']);
    const recipient = await readFile(certificate, 'utf8');
    expect(() => recipientCertificate(recipient + '-----BEGIN PRIVATE KEY-----')).toThrow();
    await expect(captureBackup({ data, recipient, database: { ...env, PGPORT: '1' },
      signal: AbortSignal.timeout(8000) })).rejects.toThrow('Archive capture');
    expect(await readdir(join(data, 'backups'))).toEqual([]);

    const snapshot = await captureBackup({ data, recipient, database: env, signal: AbortSignal.timeout(15_000) });
    const folder = join(data, 'backups', snapshot.name);
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
    expect(manifest.format).toBe('coast-backup-v1');
    expect(manifest.name).toBe(snapshot.name);
    expect(manifest.files['database.cms'].sha256).toMatch(/^[0-9a-f]{64}$/);
    const dump = join(root, 'restore.dump');
    const archive = join(root, 'restore.tar.gz');
    for (const [input, output] of [['database.cms', dump], ['app-files.cms', archive]]) {
      await command(['openssl', 'cms', '-decrypt', '-inform', 'DER', '-binary', '-inkey', key,
        '-in', join(folder, input), '-out', output]);
    }
    await database.unsafe(`create database ${restoredName}`);
    created = true;
    await command(['pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
      '-d', restoredName, dump]);
    url.pathname = '/' + restoredName;
    restored = new Bun.SQL(url.toString());
    expect((await restored`select value from coast_backup_fixture`)[0].value).toBe('fixture row');
    expect(await command(['tar', '-xOzf', archive, 'secrets/credentials.key'])).toBe('fixture key bytes');
    expect(await command(['tar', '-xOzf', archive, 'avatars/profile.png'])).toBe('fixture avatar bytes');

    const legacy = join(data, 'backups', 'coast-2026-11-03');
    await mkdir(legacy);
    await pruneBackups(data, 1, snapshot.name);
    expect((await readdir(join(data, 'backups'))).sort()).toEqual(['coast-2026-11-03', snapshot.name].sort());
  } finally {
    await restored?.close();
    if (created) await database.unsafe(`drop database ${restoredName} with (force)`);
    await closeDb();
    await rm(root, { recursive: true, force: true });
  }
});
