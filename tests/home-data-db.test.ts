import { afterAll, expect, test } from 'bun:test';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { homeData } from '../src/lib/server/queries/home';
import { progressData } from '../src/lib/server/queries/progress';
import { heroTitleIds } from '../src/lib/media/hero';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
afterAll(async () => { if (process.env.COAST_DB_TEST === '1') await closeDb(); });
async function account() {
  const id = crypto.randomUUID();
  await getDb().insert(s.users).values({ id, username: `hero-${id}` });
  return id;
}
async function library(userId: string, mediaIds: string[]) {
  const db = getDb(), instanceId = crypto.randomUUID(), connectionId = crypto.randomUUID();
  await db.insert(s.providerInstances).values({ id: instanceId, provider: 'jellyfin', name: 'Hero fixture', baseUrl: 'https://fixture.invalid' });
  await db.insert(s.providerConnections).values({ id: connectionId, instanceId, userId });
  const items = await db.insert(s.providerItems).values(mediaIds.map(mediaId => ({ instanceId, mediaId, kind: 'movie' as const, externalId: mediaId }))).returning();
  await db.insert(s.availability).values(items.map(item => ({ userId, connectionId, mediaId: item.mediaId!, providerItemId: item.id })));
  return { instanceId, connectionId };
}

run('the initial home payload contains only the hero and follows Continue, saved, Library, watched priority', async () => {
  const db = getDb(), raw = getSql(), user = await account();
  const active = crypto.randomUUID(), saved = crypto.randomUUID(), available = crypto.randomUUID(), watched = crypto.randomUUID();
  await db.insert(s.media).values([active, saved, available, watched].map(id => ({ id, kind: 'movie' as const, title: `Hero ${id}` })));
  await db.insert(s.trackingState).values([
    { userId: user, mediaId: active, positionSeconds: 30, durationSeconds: 600, updatedAt: new Date('2025-01-01') },
    { userId: user, mediaId: saved, watchlist: true, updatedAt: new Date('2025-02-01') },
    { userId: user, mediaId: watched, watched: true, updatedAt: new Date('2025-03-01') },
  ]);
  const { connectionId } = await library(user, [available]);
  const first = await homeData(user);
  expect(Object.keys(first).sort()).toEqual(['hero', 'heroNext']);
  expect(first.hero?.id).toBe(active);
  expect(first.hero?.id).toBe(heroTitleIds((await progressData(user)).items)[0]);
  await raw`update tracking_state set position_seconds=0 where user_id=${user} and media_id=${active}`;
  expect((await homeData(user)).hero?.id).toBe(saved);
  await raw`update tracking_state set watchlist=false where user_id=${user} and media_id=${saved}`;
  expect((await homeData(user)).hero?.id).toBe(available);
  await raw`update provider_connections set status='disconnected' where id=${connectionId}`;
  expect((await homeData(user)).hero?.id).toBe(watched);
});

run('a saved season and continuing episodes select their show while the shelf retains episode captions', async () => {
  const db = getDb(), raw = getSql(), user = await account();
  const show = crypto.randomUUID(), season = crypto.randomUUID(), episodes = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(s.media).values([
    { id: show, kind: 'show', title: 'Hero show' }, { id: season, kind: 'season', title: 'Season one' },
    ...episodes.map((id, index) => ({ id, kind: 'episode' as const, title: `Episode ${index + 1}` })),
  ]);
  await db.insert(s.shows).values({ mediaId: show });
  await db.insert(s.seasons).values({ mediaId: season, showId: show, seasonNumber: 1 });
  await db.insert(s.episodes).values(episodes.map((mediaId, index) => ({ mediaId, showId: show, seasonId: season, seasonNumber: 1, episodeNumber: index + 1 })));
  await db.insert(s.trackingState).values({ userId: user, mediaId: season, watchlist: true });
  expect((await homeData(user)).hero?.id).toBe(show);
  await raw`update tracking_state set watchlist=false where user_id=${user}`;
  await db.insert(s.trackingState).values({ userId: user, mediaId: episodes[0], watched: true });
  const progress = await progressData(user), home = await homeData(user);
  expect(home.hero?.id).toBe(heroTitleIds(progress.items)[0]);
  expect(home.hero?.id).toBe(show);
  expect(progress.items[0].id).toBe(episodes[1]);
  expect(progress.items[0].captionTitle).toBe('Hero show');
});

run('saved selection keeps the latest 300 states and older unfinished states without expanding untouched history', async () => {
  const db = getDb(), raw = getSql(), user = await account();
  const recent = Array.from({ length: 300 }, () => crypto.randomUUID()), oldShow = crypto.randomUUID();
  await db.insert(s.media).values([...recent.map(id => ({ id, kind: 'movie' as const, title: 'Recent watched' })), { id: oldShow, kind: 'show', title: 'Old saved show' }]);
  await db.insert(s.trackingState).values([
    ...recent.map((mediaId, index) => ({ userId: user, mediaId, watched: true, updatedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)) })),
    { userId: user, mediaId: oldShow, watchlist: true, updatedAt: new Date('2020-01-01') },
  ]);
  expect((await homeData(user)).hero?.id).toBe(recent.at(-1));
  await raw`update tracking_state set position_seconds=10,duration_seconds=600 where user_id=${user} and media_id=${oldShow}`;
  expect((await homeData(user)).hero?.id).toBe(oldShow);
});

run('Library hero retains its 100-root bound, metadata ordering and per-viewer availability', async () => {
  const db = getDb(), raw = getSql(), user = await account(), other = await account();
  const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
  await db.insert(s.media).values(ids.map((id, index) => ({ id, kind: 'movie' as const, title: `Library ${index}`, updatedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)) })));
  const { connectionId } = await library(user, ids);
  for (let index = 0; index < ids.length; index++)
    await raw`update availability set verified_at=${new Date(Date.UTC(2026, 0, 1, 0, 0, 101 - index))} where connection_id=${connectionId} and media_id=${ids[index]}`;
  expect((await homeData(user)).hero?.id).toBe(ids[99]);
  expect(await homeData(other)).toEqual({ hero: null, heroNext: null });
});
