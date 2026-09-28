import { beforeAll, afterAll, test, expect } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import { ingestMetadata } from '../src/lib/catalogue/service';
import { JellyfinAdapter } from '../src/lib/providers/jellyfin/adapter.server';
import {
  media,
  externalIds,
  metadataSnapshots,
  metadataOverrides,
  providerInstances,
} from '../src/lib/server/db/schema';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const prefix = crypto.randomUUID();
const ids: string[] = [];
let instanceId: string;
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const [instance] = await getDb()
    .insert(providerInstances)
    .values({
      provider: 'jellyfin',
      name: `Provider test ${prefix}`,
      baseUrl: 'https://fixture.invalid',
      settings: { approved: true },
    })
    .returning();
  instanceId = instance.id;
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  if (ids.length)
    await getDb()
      .delete(media)
      .where(inArray(media.id, [...new Set(ids)]));
  if (instanceId)
    await getDb().delete(providerInstances).where(eq(providerInstances.id, instanceId));
});
run(
  'concurrent provider ingestion shares one canonical identity and preserves snapshots',
  async () => {
    const tmdbId = `fixture-${prefix}`;
    const results = await Promise.all([
      ingestMetadata({
        provider: 'tmdb',
        externalId: tmdbId,
        kind: 'movie',
        title: 'Global title',
        originalTitle: 'Original title',
        externalIds: { tmdb: tmdbId },
      }),
      ingestMetadata(
        {
          provider: 'jellyfin',
          externalId: `local-${prefix}`,
          kind: 'movie',
          title: 'Local title',
          externalIds: { tmdb: tmdbId },
        },
        { instanceId }
      ),
    ]);
    ids.push(...results.map((x) => x.id));
    expect(results[0].id).toBe(results[1].id);
    const mappings = await getDb()
      .select()
      .from(externalIds)
      .where(eq(externalIds.mediaId, results[0].id));
    expect(mappings).toHaveLength(2);
    const snapshots = await getDb()
      .select()
      .from(metadataSnapshots)
      .where(eq(metadataSnapshots.mediaId, results[0].id));
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((x) => x.title).sort()).toEqual(['Global title', 'Local title']);
    await getDb()
      .insert(metadataOverrides)
      .values({ mediaId: results[0].id, title: 'Administrator title' });
    await ingestMetadata({
      provider: 'tmdb',
      externalId: tmdbId,
      kind: 'movie',
      title: 'Refreshed global title',
    });
    const [override] = await getDb()
      .select()
      .from(metadataOverrides)
      .where(eq(metadataOverrides.mediaId, results[0].id));
    expect(override.title).toBe('Administrator title');
  }
);
run('Jellyfin movies in the same collection retain distinct canonical identities', async () => {
  const firstTmdb = `collection-first-${prefix}`, secondTmdb = `collection-second-${prefix}`;
  const existing = await ingestMetadata({ provider: 'tmdb', externalId: firstTmdb, kind: 'movie', title: 'First collection movie' });
  ids.push(existing.id);
  const adapter = new JellyfinAdapter(async () => ({
    Items: [
      { Id: `jellyfin-first-${prefix}`, Name: 'First collection movie', Type: 'Movie', ProviderIds: { Tmdb: firstTmdb, TmdbCollection: `shared-${prefix}` } },
      { Id: `jellyfin-second-${prefix}`, Name: 'Second collection movie', Type: 'Movie', ProviderIds: { Tmdb: secondTmdb, TmdbCollection: `shared-${prefix}` } },
    ], TotalRecordCount: 2,
  }), 'fixture-device');
  const page = await adapter.library('fixture-user');
  const imported = [];
  for (const item of page.items) {
    const saved = await ingestMetadata(item.metadata, { instanceId });
    ids.push(saved.id); imported.push(saved);
  }
  expect(imported[0].id).toBe(existing.id);
  expect(imported[1].id).not.toBe(existing.id);
  const mappings = await getDb().select().from(externalIds).where(inArray(externalIds.mediaId, imported.map((item) => item.id)));
  expect(mappings.some((mapping) => mapping.provider === 'tmdbcollection')).toBe(false);
  expect(new Set(mappings.filter((mapping) => mapping.provider === 'tmdb').map((mapping) => mapping.mediaId)).size).toBe(2);
});
run(
  'episode provider identities converge on stable show/season position without recreating media',
  async () => {
    const show = await ingestMetadata({
      provider: 'tmdb',
      externalId: `show-${prefix}`,
      kind: 'show',
      title: 'Fixture show',
    });
    ids.push(show.id);
    const season = await ingestMetadata(
      {
        provider: 'tmdb',
        externalId: `season-${prefix}`,
        kind: 'season',
        title: 'Season 1',
        seasonNumber: 1,
      },
      { showId: show.id }
    );
    ids.push(season.id);
    const first = await ingestMetadata(
      {
        provider: 'jellyfin',
        externalId: `episode-${prefix}`,
        kind: 'episode',
        title: 'Local episode',
        seasonNumber: 1,
        episodeNumber: 1,
      },
      { showId: show.id, seasonId: season.id, instanceId }
    );
    ids.push(first.id);
    const second = await ingestMetadata(
      {
        provider: 'tmdb',
        externalId: `global-episode-${prefix}`,
        kind: 'episode',
        title: 'Global episode',
        seasonNumber: 1,
        episodeNumber: 1,
      },
      { showId: show.id, seasonId: season.id }
    );
    expect(first.id).toBe(second.id);
    const snapshots = await getDb()
      .select()
      .from(metadataSnapshots)
      .where(eq(metadataSnapshots.mediaId, first.id));
    expect(snapshots).toHaveLength(2);
  }
);
run(
  'conflicting external identities do not silently merge unrelated canonical movies',
  async () => {
    const first = await ingestMetadata({
        provider: 'tmdb',
        externalId: `one-${prefix}`,
        kind: 'movie',
        title: 'First',
      }),
      second = await ingestMetadata({
        provider: 'imdb',
        externalId: `two-${prefix}`,
        kind: 'movie',
        title: 'Second',
      });
    ids.push(first.id, second.id);
    await expect(
      ingestMetadata(
        {
          provider: 'jellyfin',
          externalId: `conflict-${prefix}`,
          kind: 'movie',
          title: 'Conflict',
          externalIds: { tmdb: `one-${prefix}`, imdb: `two-${prefix}` },
        },
        { instanceId }
      )
    ).rejects.toThrow('Conflicting provider identities');
    expect(
      await getDb()
        .select()
        .from(externalIds)
        .where(
          and(
            eq(externalIds.provider, `jellyfin:${instanceId}`),
            eq(externalIds.externalId, `conflict-${prefix}`)
          )
        )
    ).toHaveLength(0);
  }
);
run(
  'partial search metadata preserves complete fields, while explicit detail refresh replaces them',
  async () => {
    const externalId = `details-${prefix}`;
    const item = await ingestMetadata(
      {
        provider: 'tmdb',
        externalId,
        kind: 'movie',
        title: 'Complete title',
        runtimeMinutes: 123,
        genres: ['Drama'],
        certificate: '15',
      },
      { complete: true }
    );
    ids.push(item.id);
    await ingestMetadata({
      provider: 'tmdb',
      externalId,
      kind: 'movie',
      title: 'Search title',
      posterPath: 'https://image.tmdb.org/t/p/w780/updated.jpg',
    });
    let [snapshot] = await getDb()
      .select()
      .from(metadataSnapshots)
      .where(eq(metadataSnapshots.mediaId, item.id));
    expect(snapshot.runtimeMinutes).toBe(123);
    expect(snapshot.genres).toEqual(['Drama']);
    expect(snapshot.certificate).toBe('15');
    expect(snapshot.raw.detailLoaded).toBe(true);
    expect(snapshot.title).toBe('Search title');
    await ingestMetadata(
      {
        provider: 'tmdb',
        externalId,
        kind: 'movie',
        title: 'Refreshed complete title',
        runtimeMinutes: 140,
        genres: [],
      },
      { complete: true }
    );
    [snapshot] = await getDb()
      .select()
      .from(metadataSnapshots)
      .where(eq(metadataSnapshots.mediaId, item.id));
    expect(snapshot.runtimeMinutes).toBe(140);
    expect(snapshot.genres).toEqual([]);
    expect(snapshot.certificate).toBeNull();
  }
);
