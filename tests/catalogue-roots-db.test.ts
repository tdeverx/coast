import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { resolvedJellyfinCatalogueRoots } from '../src/lib/catalogue/maintenance.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const instances = [crypto.randomUUID(), crypto.randomUUID()];
const media = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getDb();
  await db.insert(s.providerInstances).values(instances.map((id) => ({ id, provider: 'jellyfin' as const, name: id, baseUrl: 'https://fixture.invalid' })));
  await db.insert(s.media).values(media.map((id) => ({ id, kind: 'movie' as const, title: 'Catalogue identity fixture' })));
  await db.insert(s.externalIds).values([
    { mediaId: media[0], provider: 'tmdb', externalId: '1870000001', mediaKind: 'movie' },
    { mediaId: media[2], provider: 'tmdb', externalId: '1870000002', mediaKind: 'movie' },
  ]);
  await db.insert(s.providerItems).values([
    { instanceId: instances[0], mediaId: media[0], externalId: 'resolved', kind: 'movie' },
    { instanceId: instances[0], mediaId: media[1], externalId: 'unresolved', kind: 'movie' },
    { instanceId: instances[1], mediaId: media[2], externalId: 'other-instance', kind: 'movie' },
  ]);
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb().delete(s.providerInstances).where(inArray(s.providerInstances.id, instances));
  await getDb().delete(s.media).where(inArray(s.media.id, media));
  await getDb().delete(s.works).where(inArray(s.works.id, media));
});
run('resolved root lookup requires the same instance and canonical TMDB media kind', async () => {
  expect([...(await resolvedJellyfinCatalogueRoots(instances[0], ['resolved', 'unresolved', 'other-instance']))]).toEqual(['resolved']);
  await getDb().update(s.providerItems).set({ kind: 'show' }).where(eq(s.providerItems.externalId, 'resolved'));
  expect([...(await resolvedJellyfinCatalogueRoots(instances[0], ['resolved']))]).toEqual([]);
  expect([...(await resolvedJellyfinCatalogueRoots(instances[0], []))]).toEqual([]);
});
