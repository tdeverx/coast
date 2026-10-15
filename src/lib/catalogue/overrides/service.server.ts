import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '../../server/db';
import {
  diagnostics,
  media,
  metadataLocks,
  metadataOverrides,
  metadataSnapshots,
  userMetadataPreferences,
  users,
} from '../../server/db/schema';
import { getConfig } from '../../server/config';
import { DomainError } from '../../core/errors';
import { metadataFields, resolveMetadata } from '../metadata/resolve';

const uuidSchema = v.pipe(v.string(), v.uuid());
const titleSchema = v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)));
const artworkSchema = v.nullable(
  v.pipe(
    v.string(),
    v.maxLength(2000),
    v.check((value) => {
      if (value.startsWith('/api/artwork/') || value.startsWith('/api/v1/artwork/'))
        return !value.includes('\\');
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        return false;
      }
    }, 'Artwork must be an HTTPS URL or a Coast artwork path.')
  )
);
export const metadataValuesSchema = v.object({
  title: v.optional(titleSchema),
  originalTitle: v.optional(titleSchema),
  overview: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(10000)))),
  posterPath: v.optional(artworkSchema),
  backdropPath: v.optional(artworkSchema),
  releaseDate: v.optional(v.nullable(v.pipe(v.string(), v.isoDate()))),
  runtimeMinutes: v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10000)))
  ),
  genres: v.optional(
    v.nullable(
      v.pipe(
        v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))),
        v.maxLength(30)
      )
    )
  ),
  certificate: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(40)))),
});
export const metadataOverrideInputSchema = v.object({
  values: metadataValuesSchema,
  locks: v.pipe(v.array(v.picklist(metadataFields)), v.maxLength(metadataFields.length)),
});
export const presentationInputSchema = v.object({
  title: v.optional(titleSchema),
  posterPath: v.optional(artworkSchema),
  backdropPath: v.optional(artworkSchema),
});
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function requireMetadataAccess(
  tx: Transaction,
  userId: string,
  mediaId: string,
  admin = false
) {
  v.parse(uuidSchema, userId);
  v.parse(uuidSchema, mediaId);
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.disabled, false)));
  if (!user) throw new DomainError('Sign in to change metadata preferences.', 401, 'unauthorized');
  if (admin && user.role !== 'admin')
    throw new DomainError('Only an administrator can change shared metadata.', 403, 'forbidden');
  const [item] = await tx.select().from(media).where(eq(media.id, mediaId));
  if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
  return { user, item };
}

export async function getMetadataEditor(userId: string, mediaId: string) {
  const config = await getConfig();
  return getDb().transaction(async (tx) => {
    const { item, user } = await requireMetadataAccess(tx, userId, mediaId, true);
    const snapshots = await tx
      .select()
      .from(metadataSnapshots)
      .where(eq(metadataSnapshots.mediaId, mediaId));
    const [override] = await tx
      .select()
      .from(metadataOverrides)
      .where(eq(metadataOverrides.mediaId, mediaId));
    const locks = (
      await tx.select().from(metadataLocks).where(eq(metadataLocks.mediaId, mediaId))
    ).map((row) => row.field);
    const [preference] = await tx
      .select()
      .from(userMetadataPreferences)
      .where(
        and(
          eq(userMetadataPreferences.userId, userId),
          eq(userMetadataPreferences.mediaId, mediaId)
        )
      );
    const policy = config.metadataSource === 'tmdb-only' ? 'tmdb-only' : 'local-first';
    const resolved = resolveMetadata({
      fallback: item,
      snapshots,
      override,
      locks,
      user: preference,
      policy,
      preferOriginalTitle: user.settings.originalTitles,
      region: user.settings.region,
    });
    // Raw provider boundary payloads never need to leave the service for a metadata editor.
    return {
      item,
      snapshots: snapshots.map(({ raw: _raw, ...snapshot }) => snapshot),
      override: override ?? null,
      locks,
      preference: preference ?? null,
      policy,
      resolved,
    };
  });
}

export async function saveMetadataOverrides(
  userId: string,
  mediaId: string,
  raw: v.InferInput<typeof metadataOverrideInputSchema>
) {
  const input = v.parse(metadataOverrideInputSchema, raw);
  await getDb().transaction(async (tx) => {
    await requireMetadataAccess(tx, userId, mediaId, true);
    const updated = { ...input.values, updatedBy: userId, updatedAt: new Date() };
    await tx
      .insert(metadataOverrides)
      .values({ mediaId, ...updated })
      .onConflictDoUpdate({ target: metadataOverrides.mediaId, set: updated });
    await tx.delete(metadataLocks).where(eq(metadataLocks.mediaId, mediaId));
    const fields = [...new Set(input.locks)];
    if (fields.length)
      await tx.insert(metadataLocks).values(fields.map((field) => ({ mediaId, field })));
    await tx
      .insert(diagnostics)
      .values({
        userId,
        kind: 'metadata_override',
        message: 'Administrator updated shared metadata.',
        detail: { mediaId, fields: Object.keys(input.values), locks: fields },
      });
  });
  return getMetadataEditor(userId, mediaId);
}

export async function savePresentationPreference(
  userId: string,
  mediaId: string,
  raw: v.InferInput<typeof presentationInputSchema>
) {
  const input = v.parse(presentationInputSchema, raw);
  return getDb().transaction(async (tx) => {
    await requireMetadataAccess(tx, userId, mediaId);
    const [preference] = await tx
      .insert(userMetadataPreferences)
      .values({ userId, mediaId, ...input })
      .onConflictDoUpdate({
        target: [userMetadataPreferences.userId, userMetadataPreferences.mediaId],
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    return preference;
  });
}
export async function resetPresentationPreference(userId: string, mediaId: string) {
  return getDb().transaction(async (tx) => {
    await requireMetadataAccess(tx, userId, mediaId);
    await tx
      .delete(userMetadataPreferences)
      .where(
        and(
          eq(userMetadataPreferences.userId, userId),
          eq(userMetadataPreferences.mediaId, mediaId)
        )
      );
  });
}

export async function getPresentationEditor(userId: string, mediaId: string) {
  return getDb().transaction(async (tx) => {
    await requireMetadataAccess(tx, userId, mediaId);
    const [preference] = await tx
      .select()
      .from(userMetadataPreferences)
      .where(
        and(
          eq(userMetadataPreferences.userId, userId),
          eq(userMetadataPreferences.mediaId, mediaId)
        )
      );
    const locks = (
      await tx
        .select({ field: metadataLocks.field })
        .from(metadataLocks)
        .where(eq(metadataLocks.mediaId, mediaId))
    ).map((row) => row.field);
    return { preference: preference ?? null, locks };
  });
}
