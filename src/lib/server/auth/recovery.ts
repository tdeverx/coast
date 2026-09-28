import { readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getSql } from '../db';
import { AppError } from '../security/errors';
import { dataDirectory } from '../security/credentials';
import { checkLoginRate, hashToken, randomToken } from './index';

let recoveryHash: string | undefined;
let availableUntil = 0;
const sessions = new Map<string, number>();
let initialized = false;

/** Called only at process startup. The consumed credential and recovery sessions never enter the DB. */
export async function initializeRecovery() {
  if (initialized) return;
  initialized = true;
  const path = join(dataDirectory(), 'recovery-credential');
  const consumed = `${path}.consumed-${process.pid}`;
  try {
    await rename(path, consumed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  let credential: string;
  try {
    credential = (await readFile(consumed, 'utf8')).trim();
  } finally {
    await unlink(consumed);
  }
  if (credential.length < 32 || credential.length > 256)
    throw new Error('The consumed recovery credential must contain 32–256 characters.');
  recoveryHash = await hashToken(credential);
  availableUntil = Date.now() + 4 * 60 * 60_000;
}

export async function recoveryLogin(credential: string, clientKey = 'local') {
  checkLoginRate(`recovery:${clientKey}`);
  if (
    !recoveryHash ||
    Date.now() >= availableUntil ||
    (await hashToken(credential)) !== recoveryHash
  )
    throw new AppError(401, 'The recovery credential is invalid or expired.');
  recoveryHash = undefined;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  sessions.set(await hashToken(token), expiresAt.getTime());
  return { token, expiresAt };
}

export async function resetAdministratorPassword(
  token: string,
  username: string,
  password: string
) {
  const tokenHash = await hashToken(token);
  const expiration = sessions.get(tokenHash);
  if (!expiration || expiration <= Date.now())
    throw new AppError(401, 'This recovery session is no longer available.');
  if (password.length < 12 || password.length > 128)
    throw new AppError(400, 'Use a password of 12–128 characters.');
  sessions.delete(tokenHash);
  const hash = await Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  });
  await getSql().begin(async (sql) => {
    const [user] =
      await sql`UPDATE users SET password_hash = ${hash}, disabled = FALSE WHERE username = ${username.toLowerCase().trim()} AND role = 'admin' RETURNING id`;
    if (!user) throw new AppError(404, 'That administrator account was not found.');
    await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
  });
}
