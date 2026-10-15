import { and, eq, or, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { readingWorks, workIdentifiers, works, workFeatures } from '$lib/server/db/schema';
import {namedFeatures} from '$lib/social/taste-profile';
import { DomainError } from '$lib/core/errors';
import { openLibraryEditionIdSchema, readingReferenceSchema, readingIdentitySchema, readingProviderForId, type ReadingMetadata } from '$lib/reading/model';
import { getConfig } from '$lib/server/config';
import { requireEnabledCategory } from '$lib/server/experimental';

const label = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500));
const optionalText = v.optional(v.pipe(v.string(), v.maxLength(20000)));
export const readingMetadataSchema = v.pipe(v.strictObject({
  provider: v.picklist(['openlibrary', 'comic-vine']),
  externalId: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  kind: v.picklist(['book', 'comic']),
  title: label,
  overview: optionalText,
  coverUrl: v.optional(v.pipe(v.string(), v.url(), v.maxLength(2000))),
  sourceUrl: v.pipe(v.string(), v.url(), v.maxLength(2000)),
  authors: v.pipe(v.array(label), v.maxLength(50)),
  subjects: v.pipe(v.array(label), v.maxLength(100)),
  publishedYear: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(9999))),
  releaseDate: v.optional(v.pipe(v.string(),v.isoDate())),
  pageCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000000))),
  seriesTitle: v.optional(label),
  issueNumber: v.optional(v.pipe(v.string(), v.maxLength(100))),
  identities: v.optional(v.pipe(v.array(readingIdentitySchema), v.maxLength(10))),
  editionIds: v.optional(v.pipe(v.array(openLibraryEditionIdSchema), v.maxLength(100))),
}), v.check((item) => item.provider === readingProviderForId(item.externalId)
  && v.safeParse(readingReferenceSchema, { kind: item.kind, externalId: item.externalId }).success
  && (item.kind === 'comic' || !(item.identities ?? []).some(identity => identity.provider === 'comic-vine')),  'Choose a valid provider work identity.'));

/** Provider details arrive before this transaction; verified IDs never merge through a title match. */
export async function importReading(metadata: ReadingMetadata) {
  const input = v.parse(readingMetadataSchema, metadata);
  requireEnabledCategory(await getConfig(), input.kind);
  const { identities: aliases = [], ...metadataValues } = input;
  const identities = [...new Map([{ provider: input.provider, externalId: input.externalId }, ...aliases]
    .map(identity => [`${identity.provider}:${identity.externalId}`, identity])).values()]
    .sort((a, b) => `${a.provider}:${a.externalId}`.localeCompare(`${b.provider}:${b.externalId}`));
  const values = {
    ...metadataValues,
    editionIds: input.editionIds ?? [],
    releaseDate: input.releaseDate ?? null,
    overview: input.overview ?? null,
    coverUrl: input.coverUrl ?? null,
    publishedYear: input.publishedYear ?? null,
    pageCount: input.pageCount ?? null,
    seriesTitle: input.seriesTitle ?? null,
    issueNumber: input.issueNumber ?? null,
  };
  return getDb().transaction(async (tx) => {
    // Every identity is locked in the same order, including aliases, before writing.
    for (const identity of identities) {
      const key = `reading:${identity.provider}:${identity.externalId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`);
    }
    const identityCondition = or(...identities.map(identity => and(
      eq(workIdentifiers.provider, identity.provider), eq(workIdentifiers.externalId, identity.externalId),
      sql`${workIdentifiers.kind} in ('book','comic')`)));
    const registered = await tx.select().from(workIdentifiers).where(identityCondition);
    const existingIds = [...new Set(registered.map(identity => identity.workId))];
    if (existingIds.length > 1)
      throw new DomainError('These identities already belong to separate saved works. Resolve the conflict before combining them.', 409, 'identity_conflict');
    async function saveFeatures(workId: string) {
      const features = { genres: namedFeatures(input.subjects), tags: namedFeatures(input.subjects), writers: namedFeatures(input.authors), ...(input.seriesTitle ? { franchises: namedFeatures([input.seriesTitle]) } : {}) };
      await tx.insert(workFeatures).values({ workId, provider: input.provider, features, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [workFeatures.workId, workFeatures.provider], set: { features, updatedAt: new Date() }, setWhere: sql`${workFeatures.features} is distinct from ${features}::jsonb` });
    }
    let item;
    if (existingIds.length) {
      const [existing] = await tx.select().from(readingWorks).where(eq(readingWorks.id, existingIds[0]));
      const upgrade = existing?.kind === 'book' && input.kind === 'comic' && existing.provider === 'openlibrary' && input.provider === 'openlibrary' && existing.externalId === input.externalId;
      if (!existing || existing.kind !== input.kind && !upgrade)
        throw new DomainError('This provider identity refers to a different work.', 409, 'identity_conflict');
      if (upgrade) {
        await tx.update(works).set({ category: 'comic', kind: 'comic' }).where(eq(works.id, existing.id));
        await tx.update(workIdentifiers).set({ kind: 'comic' }).where(eq(workIdentifiers.workId, existing.id));
      }
      // Alternate-source enrichment never changes UUIDs or overwrites primary metadata.
      const update = existing.provider === input.provider && existing.externalId === input.externalId ? values : {
        overview: existing.overview ?? values.overview,
        coverUrl: existing.coverUrl ?? values.coverUrl,
        pageCount: existing.pageCount ?? values.pageCount,
        authors: existing.authors.length ? existing.authors : values.authors,
        subjects: [...new Set([...existing.subjects, ...values.subjects])].slice(0, 100),
      };
      const changed = Object.entries(update).some(([field, value]) => JSON.stringify(existing[field as keyof typeof existing]) !== JSON.stringify(value));
      item = changed ? (await tx.update(readingWorks).set({ ...update, updatedAt: new Date() }).where(eq(readingWorks.id, existing.id)).returning())[0] : existing;
    } else {
      const [work] = await tx.insert(works).values({ category: input.kind, kind: input.kind }).returning({ id: works.id });
      [item] = await tx.insert(readingWorks).values({ id: work.id, ...values }).returning();
    }
    await tx.insert(workIdentifiers).values(identities.map(identity => ({ workId: item.id, ...identity, kind: input.kind }))).onConflictDoNothing();
    const saved = await tx.select().from(workIdentifiers).where(identityCondition);
    if (saved.length !== identities.length || saved.some(identity => identity.workId !== item.id))
      throw new DomainError('This provider identity changed. Retry the import.', 409, 'identity_conflict');
    await saveFeatures(item.id);
    return item;
  });
}
