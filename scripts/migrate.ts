import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import {RuntimeAudit, migrationFingerprint} from './runtime-audit';

const directory = `${import.meta.dir}/../drizzle`;
const audit = new RuntimeAudit(process.env.COAST_DATA_DIR || '/data');
const started = performance.now();
const fingerprint = await migrationFingerprint(directory).catch(() => ({}));
const metadata: Record<string, unknown> = {pid: process.pid, bunVersion: Bun.version,
  postgresVersion: process.env.COAST_POSTGRES_VERSION?.match(/^postgres \(PostgreSQL\) (\d+\.\d+(?:\.\d+)?)/)?.[1] || 'unknown',
  build: process.env.COAST_BUILD_ID || 'unknown', ...fingerprint};
await audit.write('migration.start', metadata);

try {
  await migrate(getDb(), { migrationsFolder: directory });
  // One bounded version query after successful migration; no recurring database polling.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const version = getSql().unsafe(`SELECT current_setting('server_version') AS server_version,
      count(*)::int AS applied_count,
      (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS latest_hash
      FROM drizzle.__drizzle_migrations`);
    const rows = await Promise.race([version, new Promise<undefined>(resolve => {
      timeout = setTimeout(() => { try { version.cancel(); } catch {} resolve(undefined); }, 250);
    })]);
    const value = String(rows?.[0]?.server_version).match(/^\d+\.\d+(?:\.\d+)?/)?.[0];
    if (value) metadata.postgresVersion = value;
    if (rows) {
      metadata.appliedMigrationCount = rows[0].applied_count;
      metadata.latestAppliedMigrationSha256 = rows[0].latest_hash;
    }
  } catch { /* Metadata collection must not change the migration result. */ }
  finally { if (timeout) clearTimeout(timeout); }
  await audit.write('migration.complete', {...metadata, durationMs: performance.now() - started});
  console.info('Coast database migrations completed.');
} catch (error) {
  await audit.write('migration.failed', {...metadata, durationMs: performance.now() - started});
  console.error(
    'Coast database migration failed:',
    error instanceof Error ? error.message : 'Unknown database error'
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
