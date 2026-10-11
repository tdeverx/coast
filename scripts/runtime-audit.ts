import {createHash} from 'node:crypto';
import {appendFile, chmod, mkdir, readFile, rename, stat} from 'node:fs/promises';
import {join} from 'node:path';

export const auditLimits = {segmentBytes: 128 * 1024, pending: 8, waitMs: 250};
type Event = 'migration.start' | 'migration.complete' | 'migration.failed' | 'database.start' | 'database.exit' | 'database.ready' | 'database.failed' | 'database.shutdown';
type IO = Pick<typeof import('node:fs/promises'), 'appendFile' | 'chmod' | 'mkdir' | 'rename' | 'stat'>;
const filesystem: IO = {appendFile, chmod, mkdir, rename, stat};

/** Closed, metadata-only audit; no errors, URLs, SQL, rows, paths or credential values. */
export function safeAuditFields(input: Record<string, unknown>) {
  const fields: Record<string, string | number> = {};
  for (const key of ['migrationCount', 'appliedMigrationCount', 'pid', 'durationMs', 'exitCode']) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12) fields[key] = Math.round(value);
  }
  for (const key of ['journalSha256', 'migrationsSha256', 'lastMigrationSha256', 'latestAppliedMigrationSha256']) {
    const value = input[key];
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) fields[key] = value;
  }
  for (const key of ['bunVersion', 'postgresVersion']) {
    const value = input[key];
    if (typeof value === 'string' && /^(?:\d{1,3}\.\d{1,3}(?:\.\d{1,3})?|unknown)$/.test(value)) fields[key] = value;
  }
  const build = input.build;
  if (typeof build === 'string' && /^(?:[a-f0-9]{40}|sha256:[a-f0-9]{64}|unknown)$/.test(build)) fields.build = build;
  if (['storage-corrupt', 'connection-limit', 'panic', 'shutdown-start', 'shutdown-complete'].includes(String(input.code))) fields.code = String(input.code);
  return fields;
}

/** Bounded pending work and caller wait. A failed audit never changes migration status. */
export class RuntimeAudit {
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();
  constructor(private directory: string, private io: IO = filesystem, private category: 'migrations' | 'database-events' = 'migrations') {}
  async write(event: Event, input: Record<string, unknown>) {
    if (this.pending >= auditLimits.pending) return;
    let line: string;
    try {
      if (!['migration.start', 'migration.complete', 'migration.failed', 'database.start', 'database.exit', 'database.ready', 'database.failed', 'database.shutdown'].includes(event)) return;
      line = JSON.stringify({createdAt: new Date().toISOString(), kind: event, detail: safeAuditFields(input)}) + '\n';
      if (Buffer.byteLength(line) > 4096) return;
    } catch { return; }
    this.pending++;
    this.tail = this.tail.then(async () => {
      const folder = join(this.directory, 'runtime');
      const path = join(folder, this.category + '.jsonl');
      await this.io.mkdir(folder, {recursive: true, mode: 0o700});
      await this.io.chmod(folder, 0o700);
      const size = await this.io.stat(path).then(file => file.size).catch(() => 0);
      if (size + Buffer.byteLength(line) > (this.category === 'migrations' ? auditLimits.segmentBytes : 1024 * 1024)) await this.io.rename(path, path + '.1');
      await this.io.appendFile(path, line, {mode: 0o600});
      await this.io.chmod(path, 0o600);
    }).catch(() => {}).finally(() => { this.pending--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([this.tail, new Promise<void>(resolve => { timer = setTimeout(resolve, auditLimits.waitMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
}

export async function migrationFingerprint(directory: string) {
  const journal = await readFile(join(directory, 'meta', '_journal.json'));
  if (journal.length > 1024 * 1024) throw Error('Migration journal too large.');
  const entries = JSON.parse(journal.toString()).entries as {tag: string}[];
  if (!Array.isArray(entries) || entries.length > 200) throw Error('Invalid migration journal.');
  const hash = createHash('sha256');
  let bytes = 0, lastMigrationSha256 = '';
  for (const entry of entries) {
    if (!/^\d{4}_[a-zA-Z0-9_]+$/.test(entry.tag)) throw Error('Invalid migration tag.');
    const sql = await readFile(join(directory, `${entry.tag}.sql`));
    bytes += sql.length;
    if (bytes > 16 * 1024 * 1024) throw Error('Migration source too large.');
    lastMigrationSha256 = createHash('sha256').update(sql).digest('hex');
    hash.update(entry.tag + '\0' + lastMigrationSha256 + '\0');
  }
  return {migrationCount: entries.length, journalSha256: createHash('sha256').update(journal).digest('hex'),
    migrationsSha256: hash.digest('hex'), lastMigrationSha256};
}
