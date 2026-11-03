import * as v from 'valibot';
import type { SQL } from 'bun';
import { requireAdmin, type SessionUser } from '#lib/server/auth/index.js';
import { getConfig } from '#lib/server/config.js';
import { getSql } from '#lib/server/db/index.js';
import { dataDirectory } from '#lib/server/security/credentials.js';
import { AppError } from '#lib/server/security/errors.js';
import { captureBackup, pruneBackups, recipientCertificate } from './archive.server';
import { defaultBackupPolicy, dueBackupDay, type BackupPolicy, type BackupStatus } from './model';

const policyKey = 'backup-policy';
const jobKey = 'backup-job';
const lease = 'coast-backup';
const policySchema = v.strictObject({
  enabled: v.boolean(),
  time: v.pipe(v.string(), v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)),
  timeZone: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
  keep: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)),
  recipient: v.pipe(v.string(), v.trim(), v.maxLength(16_384)),
});

type Job = Pick<BackupStatus, 'state' | 'attemptedAt' | 'error' | 'latest'> & {
  scheduledDay: string | null;
};
const initialJob: Job = {
  state: 'idle', attemptedAt: null, error: null, latest: null, scheduledDay: null,
};

function backupDatabase() {
  if (process.env.COAST_BUNDLED_POSTGRES !== '1') return null;
  const url = URL.parse(process.env.DATABASE_URL ?? '');
  if (!url || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      url.port !== '5432' || url.pathname !== '/coast' || url.username !== 'coast' ||
      !/^[a-f0-9]{64}$/.test(url.password) || url.search || url.hash) return null;
  return {
    PGHOST: url.hostname, PGPORT: url.port, PGDATABASE: 'coast', PGUSER: 'coast',
    PGPASSWORD: url.password, PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c default_transaction_read_only=on',
  };
}

async function readState(database: SQL) {
  const rows = await database<{ key: string; value: unknown }[]>`
    select key, value from system_settings where key in (${policyKey}, ${jobKey})`;
  const policy = v.safeParse(policySchema, rows.find((row) => row.key === policyKey)?.value);
  const job = rows.find((row) => row.key === jobKey)?.value as Job | undefined;
  return { policy: policy.success ? policy.output : defaultBackupPolicy, job: job ?? initialJob };
}

async function saveValue(database: SQL, key: string, value: BackupPolicy | Job) {
  await database`insert into system_settings (key, value) values (${key}, ${value}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

export async function backupStatus(actor: SessionUser | null): Promise<BackupStatus> {
  requireAdmin(actor);
  const { policy, job } = await readState(getSql());
  return {
    available: Boolean(backupDatabase()), policy, state: job.state,
    attemptedAt: job.attemptedAt, error: job.error, latest: job.latest,
  };
}

export async function configureBackups(actor: SessionUser | null, body: unknown) {
  requireAdmin(actor);
  if (!backupDatabase()) throw new AppError(409, 'Backups require Coast’s bundled PostgreSQL.');
  const policy = v.parse(policySchema, body);
  try {
    policy.timeZone = new Intl.DateTimeFormat('en', { timeZone: policy.timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new AppError(400, 'Enter a valid time zone, such as Europe/London.');
  }
  if (policy.enabled && !policy.recipient)
    throw new AppError(400, 'Set a public recovery certificate before enabling backups.');
  if (policy.recipient) {
    try {
      policy.recipient = recipientCertificate(policy.recipient).toString();
    } catch {
      throw new AppError(400, 'Enter a single public RSA certificate with at least 2048 bits.');
    }
  }
  await saveValue(getSql(), policyKey, policy);
  return backupStatus(actor);
}

export async function queueBackup(actor: SessionUser | null) {
  requireAdmin(actor);
  if (!backupDatabase()) throw new AppError(409, 'Backups require Coast’s bundled PostgreSQL.');
  await getSql().begin(async (database) => {
    const [lock] = await database`select pg_try_advisory_xact_lock(hashtextextended(${lease}, 0)) as acquired`;
    if (!lock.acquired) return;
    const { policy, job } = await readState(database);
    if (!policy.recipient) throw new AppError(400, 'Set a public recovery certificate first.');
    await saveValue(database, jobKey, { ...job, state: 'queued', error: null });
  });
  return backupStatus(actor);
}

async function work(signal: AbortSignal) {
  const database = backupDatabase();
  if (!database || signal.aborted) return;
  const pool = getSql();
  const pending = await readState(pool);
  if (pending.job.state !== 'queued' && pending.job.state !== 'running') {
    const day = pending.policy.enabled ? dueBackupDay(pending.policy, new Date()) : null;
    if (!day || day === pending.job.scheduledDay) return;
  }
  const connection = await pool.reserve();
  let acquired = false;
  try {
    const [lock] = await connection`select pg_try_advisory_lock(hashtextextended(${lease}, 0)) as acquired,
      pg_backend_pid() as backend`;
    acquired = lock.acquired;
    if (!acquired || signal.aborted) return;
    const { policy, job } = await readState(connection);
    if (job.state === 'running') {
      // An unlocked running record belongs to a worker that stopped before recording its result.
      await saveValue(connection, jobKey, {
        ...job, state: 'failed', error: 'Coast stopped before the backup finished.',
      });
      return;
    }
    const now = new Date();
    const day = policy.enabled ? dueBackupDay(policy, now) : null;
    const scheduled = job.state !== 'queued';
    if (scheduled && (!day || day === job.scheduledDay || (await getConfig(pool)).developerMode)) return;
    const running: Job = {
      ...job, state: 'running', error: null, attemptedAt: now.toISOString(),
      scheduledDay: scheduled ? day : job.scheduledDay,
    };
    await saveValue(connection, jobKey, running);
    let snapshot: Job['latest'];
    try {
      if (!policy.recipient) throw new Error('Missing recovery certificate.');
      snapshot = await captureBackup({
        data: dataDirectory(), recipient: policy.recipient, database,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20 * 60_000)]),
        beforePublish: async () => {
          const [owner] = await connection`select pg_backend_pid() as backend`;
          if (owner.backend !== lock.backend) throw new Error('Backup database lease changed.');
        },
      });
    } catch {
      await saveValue(connection, jobKey, {
        ...running, state: 'failed',
        error: signal.aborted ? 'Coast stopped before the backup finished.' :
          'Backup failed. Check PostgreSQL access, free space and the backups folder permissions.',
      });
      return;
    }
    let warning: string | null = null;
    try {
      await pruneBackups(dataDirectory(), policy.keep, snapshot.name);
    } catch {
      warning = 'Backup saved. Coast could not remove older snapshots.';
    }
    await saveValue(connection, jobKey, { ...running, state: 'completed', latest: snapshot, error: warning });
  } finally {
    try {
      if (acquired) await connection`select pg_advisory_unlock(hashtextextended(${lease}, 0))`;
    } finally {
      connection.release();
    }
  }
}

export function startBackupScheduler() {
  if (!backupDatabase()) return () => {};
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      await work(controller.signal);
    } catch {
      // A database outage must not stop the scheduler.
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(() => void tick(), 15_000).unref();
    }
  };
  timer = setTimeout(() => void tick(), 0).unref();
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}
