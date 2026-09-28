import { beforeAll, afterAll, test, expect } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { ingestMetadata } from '../src/lib/catalogue/service';
import { detailsData } from '../src/lib/server/queries/media';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const uid = crypto.randomUUID(),
  ids: string[] = [];
let show: string, season: string, episode: string, collection: string, movie: string;
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .insert(s.users)
    .values({ id: uid, username: `details-${uid}`, passwordHash: 'test-unused' });
  const add = async (
    metadata: Parameters<typeof ingestMetadata>[0],
    options?: Parameters<typeof ingestMetadata>[1]
  ) => {
    const saved = await ingestMetadata(metadata, options);
    ids.push(saved.id);
    return saved.id;
  };
  show = await add({
    provider: 'tmdb',
    externalId: `show-${uid}`,
    kind: 'show',
    title: 'Show',
    cast: [{ id: 1, name: 'Show cast', character: 'Main' }],
  });
  season = await add(
    {
      provider: 'tmdb',
      externalId: `season-${uid}`,
      kind: 'season',
      title: 'Named season',
      seasonNumber: 1,
    },
    { showId: show }
  );
  episode = await add(
    {
      provider: 'tmdb',
      externalId: `episode-${uid}`,
      kind: 'episode',
      title: 'Episode',
      seasonNumber: 1,
      episodeNumber: 1,
      cast: [{ id: 2, name: 'Episode guest', character: 'Guest' }],
    },
    { showId: show, seasonId: season }
  );
  movie = await add({
    provider: 'tmdb',
    externalId: `movie-${uid}`,
    kind: 'movie',
    title: 'Movie',
  });
  collection = await add({
    provider: 'tmdb',
    externalId: `collection-${uid}`,
    kind: 'collection',
    title: 'Ordered collection',
  });
  await getDb()
    .insert(s.mediaRelationships)
    .values([
      { parentId: collection, childId: episode, kind: 'collection', position: 0 },
      { parentId: collection, childId: movie, kind: 'collection', position: 1 },
    ]);
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  if (ids.length) await getDb().delete(s.media).where(inArray(s.media.id, ids));
  await getDb().delete(s.users).where(eq(s.users.id, uid));
});
run('show details return season posters without hydrating every episode', async () => {
  const data = await detailsData(uid, show);
  expect(data.episodes).toEqual([]);
  expect(data.seasons.map((s) => s.item?.id)).toEqual([season]);
  expect(data.cast[0].name).toBe('Show cast');
});
run('season and episode details retain hierarchy and specific credits', async () => {
  const seasonData = await detailsData(uid, season);
  expect(seasonData.episodes.map((e) => e.id)).toEqual([episode]);
  expect(seasonData.parents.map((p) => p.id)).toEqual([show]);
  const episodeData = await detailsData(uid, episode);
  expect(episodeData.parents.map((p) => p.id)).toEqual([show, season]);
  expect(episodeData.cast[0].name).toBe('Episode guest');
});
run('collection page preserves the explicit mixed sequence', async () => {
  const data = await detailsData(uid, collection);
  expect(data.members.map((m) => m.id)).toEqual([episode, movie]);
  expect(data.members.every((m) => m.sequence)).toBe(true);
});

run(
  'media activity shares profile watch semantics, scopes descendants and separates undated history',
  async () => {
    const { mediaStatistics } = await import('../src/lib/server/queries/media-statistics');
    const { profileActivity } = await import('../src/lib/server/queries/profile');
    const now = new Date('2026-09-28T12:00:00Z');
    const rows = [
      { mediaId: episode, action: 'watch' as const, occurredAt: new Date('2026-09-01T10:00:00Z') },
      { mediaId: episode, action: 'watch' as const, occurredAt: new Date('2026-09-02T10:00:00Z') },
      {
        mediaId: episode,
        action: 'watch' as const,
        rewatch: true,
        occurredAt: new Date('2026-09-03T10:00:00Z'),
      },
      {
        mediaId: episode,
        action: 'watch' as const,
        rewatch: true,
        applied: false,
        occurredAt: new Date('2026-09-04T10:00:00Z'),
      },
      {
        mediaId: movie,
        action: 'watch' as const,
        occurredAtKnown: false,
        occurredAt: new Date('2026-01-01T10:00:00Z'),
      },
      {
        mediaId: episode,
        action: 'watch' as const,
        rewatch: true,
        occurredAt: new Date('2027-01-01T10:00:00Z'),
      },
    ];
    await getDb()
      .insert(s.trackingEvents)
      .values(rows.map((row) => ({ ...row, userId: uid })));
    const showStats = await mediaStatistics(uid, show, 'all', now);
    expect(showStats.watches).toBe(2);
    expect(showStats.unique).toBe(1);
    expect(showStats.days).toEqual([
      { date: '2026-09-01', movies: 0, episodes: 1 },
      { date: '2026-09-03', movies: 0, episodes: 1 },
    ]);
    expect((await mediaStatistics(uid, season, 'all', now)).days).toEqual(showStats.days);
    const combined = await mediaStatistics(uid, collection, 'all', now);
    expect(combined.watches).toBe(3);
    expect(combined.undated).toBe(1);
    expect((await mediaStatistics(uid, collection, 'month', now)).watches).toBe(2);
    expect((await profileActivity(uid, now, 'all')).days).toEqual(showStats.days);
    expect((await mediaStatistics(crypto.randomUUID(), collection, 'all', now)).watches).toBe(0);
  }
);
