import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { dataDirectory } from '$lib/server/security/credentials';
import { AppError } from '$lib/server/security/errors';
import { requireVisible } from '$lib/social/privacy.server';

export const avatarRequestLimit = 7 * 1024 * 1024;
const directory = () => join(dataDirectory(), 'avatars');
const avatarUrl = (userId: string, hash: string) => `/api/v1/profile/avatar/${userId}/${hash}`;

export function gifBytes(avatar: string) {
  const bytes = Buffer.from(avatar.split(',')[1], 'base64');
  const signature = bytes.toString('ascii', 0, 6);
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(signature) ||
      !bytes.readUInt16LE(6) || !bytes.readUInt16LE(8))
    throw new AppError(400, 'The avatar is not a valid GIF.');
  if (bytes.length > 5 * 1024 * 1024) throw new AppError(400, 'Choose a GIF smaller than 5 MB.');
  return bytes;
}

/** Called while holding the user's row lock; store the original animation intact. */
export async function storeGifAvatar(userId: string, avatar: string) {
  const bytes = gifBytes(avatar);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const path = join(directory(), `${userId}-${hash}.gif`);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return avatarUrl(userId, hash);
}

/** Serialize cleanup with profile saves so it cannot remove a newly saved icon. */
export async function pruneGifAvatars(userId: string) {
  await getDb().transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) return;
    for (const file of await readdir(directory()).catch(() => [])) {
      const match = file.match(/^([0-9a-f-]{36})-([0-9a-f]{64})\.gif$/);
      if (match?.[1] === userId && user.settings.profile?.avatar !== avatarUrl(userId, match[2]))
        await unlink(join(directory(), file)).catch(() => {});
    }
  });
}

export async function streamGifAvatar(userId: string, hash: string, viewerId: string | null) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new AppError(404, 'Avatar not found.');
  await requireVisible(userId, viewerId, 'details');
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (user?.settings.profile?.avatar !== avatarUrl(userId, hash)) throw new AppError(404, 'Avatar not found.');
  const file = Bun.file(join(directory(), `${userId}-${hash}.gif`));
  if (!await file.exists()) throw new AppError(404, 'Avatar not found.');
  return new Response(file, { headers: {
    'Content-Type': 'image/gif', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}
