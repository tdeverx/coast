import { createHash, X509Certificate } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupSnapshot } from './model';

const archiveNames = ['database.cms', 'app-files.cms'] as const;
const contents = [...archiveNames, 'manifest.json'].sort();
const snapshotName = /^coast-app-\d{17}-[0-9a-f-]{36}$/;

export function recipientCertificate(pem: string) {
  const certificate = pem.trim().replaceAll('\r\n', '\n');
  if (!/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+\n-----END CERTIFICATE-----$/.test(certificate))
    throw new Error('A single public certificate is required.');
  const parsed = new X509Certificate(certificate);
  const key = parsed.publicKey;
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error('The recovery certificate must use RSA with at least 2048 bits.');
  return parsed;
}

async function checksum(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function seal(
  command: string[], environment: Record<string, string>, target: string,
  certificate: string, signal: AbortSignal
) {
  signal.throwIfAborted();
  const output = await open(target, 'wx', 0o600);
  try {
    const source = Bun.spawn(command, { env: environment, stdout: 'pipe', stderr: 'ignore', signal });
    let encrypt: ReturnType<typeof Bun.spawn> | undefined;
    try {
      encrypt = Bun.spawn(['openssl', 'cms', '-encrypt', '-aes-256-gcm', '-binary', '-stream',
        '-outform', 'DER', certificate], { stdin: source.stdout, stdout: output.fd, stderr: 'ignore', signal });
      const encryptionStatus = await encrypt.exited;
      if (encryptionStatus !== 0) source.kill();
      const sourceStatus = await source.exited;
      if (sourceStatus !== 0 || encryptionStatus !== 0 || signal.aborted)
        throw new Error('Archive capture or encryption failed.');
      const size = (await output.stat()).size;
      if (size === 0) throw new Error('The encrypted archive is empty.');
      await output.sync();
    } finally {
      if (source.exitCode === null) source.kill();
      if (encrypt && encrypt.exitCode === null) encrypt.kill();
      await Promise.allSettled([source.exited, encrypt?.exited]);
    }
  } finally {
    await output.close();
  }
}

export async function captureBackup(input: {
  data: string;
  recipient: string;
  database: Record<string, string>;
  signal: AbortSignal;
  beforePublish?: () => Promise<void>;
}): Promise<BackupSnapshot> {
  const certificate = recipientCertificate(input.recipient);
  const root = join(input.data, 'backups');
  await mkdir(root, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || (rootInfo.mode & 0o077))
    throw new Error('Backups require a private directory.');
  const stage = await mkdtemp(join(root, '.coast-stage-'));
  const recipient = join(stage, 'recipient.pem');
  try {
    await writeFile(recipient, certificate.toString(), { mode: 0o600, flag: 'wx' });
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' };
    await seal(['pg_dump', '--format=custom', '--compress=3', '--lock-wait-timeout=5s',
      '--no-password'], { ...env, ...input.database }, join(stage, 'database.cms'), recipient, input.signal);
    const secrets = await lstat(join(input.data, 'secrets'));
    if (!secrets.isDirectory()) throw new Error('The Coast secrets directory is unavailable.');
    const avatars = await lstat(join(input.data, 'avatars')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (avatars && !avatars.isDirectory()) throw new Error('The uploaded avatars directory is invalid.');
    await seal(['tar', '-C', input.data, '-czf', '-', 'secrets', ...(avatars ? ['avatars'] : [])],
      env, join(stage, 'app-files.cms'), recipient, input.signal);
    await unlink(recipient);

    const files = Object.fromEntries(await Promise.all(archiveNames.map(async (name) => {
      const path = join(stage, name);
      return [name, { bytes: (await lstat(path)).size, sha256: await checksum(path) }] as const;
    })));
    input.signal.throwIfAborted();
    const completedAt = new Date().toISOString();
    const name = `coast-app-${completedAt.replace(/\D/g, '')}-${crypto.randomUUID()}`;
    const snapshot = { name, completedAt, bytes: files['database.cms'].bytes + files['app-files.cms'].bytes };
    const manifest = await open(join(stage, 'manifest.json'), 'wx', 0o600);
    try {
      await manifest.writeFile(JSON.stringify({
        format: 'coast-backup-v1', ...snapshot, files,
        build: process.env.COAST_BUILD_ID ?? 'unknown',
        recipientFingerprint: certificate.fingerprint256,
      }, null, 2) + '\n');
      await manifest.sync();
    } finally {
      await manifest.close();
    }
    await syncDirectory(stage);
    await input.beforePublish?.();
    input.signal.throwIfAborted();
    await rename(stage, join(root, name));
    await syncDirectory(root);
    return snapshot;
  } finally {
    // Remove only files owned by this attempt. A successful rename leaves no stage.
    for (const name of [...contents, 'recipient.pem'])
      await unlink(join(stage, name)).catch(() => {});
    await rmdir(stage).catch(() => {});
  }
}

export async function pruneBackups(data: string, keep: number, latest: string) {
  const root = join(data, 'backups');
  const candidates: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !snapshotName.test(entry.name)) continue;
    const folder = join(root, entry.name);
    const entries = await readdir(folder, { withFileTypes: true });
    if (entries.some((file) => !file.isFile()) ||
        entries.map((file) => file.name).sort().join(',') !== contents.join(',')) continue;
    const manifestPath = join(folder, 'manifest.json');
    if ((await lstat(manifestPath)).size > 16_384) continue;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.format === 'coast-backup-v1' && manifest.name === entry.name) candidates.push(entry.name);
    } catch {
      // Leave unfamiliar or damaged snapshots to the operator.
    }
  }
  const retained = new Set([latest, ...candidates.filter((name) => name !== latest).sort().reverse().slice(0, keep - 1)]);
  for (const name of candidates) {
    if (retained.has(name)) continue;
    const folder = join(root, name);
    for (const file of contents) await unlink(join(folder, file));
    await rmdir(folder);
  }
  await syncDirectory(root);
}
