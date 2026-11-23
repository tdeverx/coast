import { afterAll, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { avatarBackupLease } from '../src/lib/backups/model';
import { pruneAvatars, pruneUnusedAvatars, stopAvatarSweep } from '../src/lib/core/profile/avatar-storage.server';
import { closeDb, getSql } from '../src/lib/server/db';
import { dataDirectory } from '../src/lib/server/security/credentials';

const enabled = process.env.COAST_DB_TEST === '1';
afterAll(async () => {
  if (enabled) {
    await stopAvatarSweep();
    await closeDb();
  }
});

test.skipIf(!enabled)('a backup lease protects avatar files from both pruning paths', async () => {
  const userId = crypto.randomUUID();
  const hash = 'a'.repeat(64);
  const directory = join(dataDirectory(), 'avatars');
  const path = join(directory, `${userId}-${hash}.png`);
  const previous = `/api/v1/profile/avatar/${userId}/${hash}`;
  await mkdir(directory, { recursive: true });
  await Bun.write(path, 'fixture avatar');
  const connection = await getSql().reserve();
  try {
    await connection`select pg_advisory_lock(hashtextextended(${avatarBackupLease}, 0))`;
    await pruneAvatars(userId, previous);
    expect(await pruneUnusedAvatars()).toMatchObject({ skipped: 1, removed: 0 });
    expect(await Bun.file(path).exists()).toBe(true);
  } finally {
    await connection`select pg_advisory_unlock(hashtextextended(${avatarBackupLease}, 0))`;
    connection.release();
  }
  await pruneAvatars(userId, previous);
  expect(await Bun.file(path).exists()).toBe(false);
});
