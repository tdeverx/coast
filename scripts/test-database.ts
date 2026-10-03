import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The configured URL is only used to create/drop isolated databases, never as a test target.
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error('Set TEST_DATABASE_URL to a PostgreSQL account allowed to create disposable databases.');
const admin = new Bun.SQL(target, { max: 1 });
const selected = process.argv.slice(2);
const files = (await readdir('tests')).filter(file => file.endsWith('-db.test.ts') && (!selected.length || selected.includes(file))).sort();
if (!files.length) throw new Error('No database test suites selected.');
let failures = 0;
try {
  for (const file of files) {
    const prefix = file === 'platform-db.test.ts' ? 'coast_platform_test' : 'coast_settings_test';
    const name = `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
    const directory = await mkdtemp(join(tmpdir(), 'coast-db-test-'));
    const url = new URL(target); url.pathname = `/${name}`;
    let created = false;
    const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(), COAST_DB_TEST: '1', COAST_DATA_DIR: directory };
    try {
      await admin.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const migration = await Bun.spawn([process.execPath, 'scripts/migrate.ts'], { env, stdout: 'inherit', stderr: 'inherit' }).exited;
      const result = migration || await Bun.spawn([process.execPath, 'test', `tests/${file}`], { env, stdout: 'inherit', stderr: 'inherit' }).exited;
      if (result) failures++;
    } finally {
      try { if (created) await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
} finally { await admin.close(); }
process.exitCode = failures ? 1 : 0;
