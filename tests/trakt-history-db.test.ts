import { afterAll, beforeAll, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { ingestMetadata } from '../src/lib/catalogue/service.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { importTraktFromAdapter } from '../src/lib/sync/trakt-import.server';
import type { SyncPreferences } from '../src/lib/providers/contracts';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const sync: SyncPreferences = { history: true, progress: false, ratings: false, watchlist: false, collection: false, lists: false, scrobble: false };
const numericId = 1880000001, tag = crypto.randomUUID();
let userId: string, instanceId: string, connectionId: string, mediaId: string;
const date = (id: number) => new Date(Date.UTC(2025, 0, 1) + Math.floor((id - 1) / 2) * 86400000).toISOString();
const source = (id: number) => `${connectionId}:history:${id}:${date(id)}`;
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getDb();
  [userId] = (await db.insert(s.users).values({ username: `trakt-history-${tag}` }).returning()).map((row) => row.id);
  [instanceId] = (await db.insert(s.providerInstances).values({ provider: 'trakt', name: tag, baseUrl: 'https://fixture.invalid' }).returning()).map((row) => row.id);
  [connectionId] = (await db.insert(s.providerConnections).values({ userId, instanceId, settings: { sync } }).returning()).map((row) => row.id);
  mediaId = (await ingestMetadata({ provider: 'trakt', externalId: String(numericId), kind: 'movie', title: 'Rewatched history fixture', runtimeMinutes: 90 })).id;
  await db.insert(s.removedTrackingSources).values({ userId, source: 'trakt', sourceEventId: source(7) });
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getDb();
  if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
  if (instanceId) await db.delete(s.providerInstances).where(eq(s.providerInstances.id, instanceId));
  if (mediaId) { await db.delete(s.media).where(eq(s.media.id, mediaId)); await db.delete(s.works).where(eq(s.works.id, mediaId)); }
});
run('history applies oldest-first across pages, retains equal-date order and suppression, and retries once', async () => {
  const movie = { title: 'Rewatched history fixture', year: 2025, runtime: 90, ids: { trakt: numericId, slug: 'ignored-slug' } };
  const records = Array.from({ length: 105 }, (_, index) => { const id = 105 - index; return { id, watched_at: date(id), movie }; });
  const fallback = { listed_at: '2024-01-01T00:00:00.000Z', movie };
  const all = [...records, fallback];
  let fail = true;
  const adapter = new TraktAdapter(async (path) => {
    const page = Number(new URL(path, 'https://fixture.invalid').searchParams.get('page'));
    if (page === 2 && fail) throw new Error('Interrupted history page');
    return all.slice((page - 1) * 100, page * 100);
  }, 'client', 'secret');
  await expect(importTraktFromAdapter(userId, connectionId, { adapter, sync })).rejects.toThrow('Interrupted history page');
  expect(await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId, userId))).toHaveLength(0);
  fail = false;
  await importTraktFromAdapter(userId, connectionId, { adapter, sync });
  const events = await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId, userId)).orderBy(asc(s.trackingEvents.createdAt));
  const ordered = [...records].sort((a, b) => a.watched_at.localeCompare(b.watched_at)).filter((record) => record.id !== 7);
  expect(events.map((event) => event.sourceEventId)).toEqual([`${connectionId}:history:${numericId}:${fallback.listed_at}`, ...ordered.map((record) => source(record.id))]);
  expect(events.every((event) => event.applied && event.rewatch && event.source === 'trakt' && event.occurredAtKnown)).toBe(true);
  expect(events.map((event) => event.occurredAt.toISOString())).toEqual([fallback.listed_at, ...ordered.map((record) => record.watched_at)]);
  const [state] = await getDb().select().from(s.trackingState).where(eq(s.trackingState.userId, userId));
  expect(state).toMatchObject({ watched: true, playCount: 105 });
  expect(state.lastWatchedAt?.toISOString()).toBe(date(105));
  await importTraktFromAdapter(userId, connectionId, { adapter, sync });
  expect(await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId, userId))).toHaveLength(events.length);
  expect((await getDb().select().from(s.trackingState).where(eq(s.trackingState.userId, userId)))[0].playCount).toBe(105);
});
