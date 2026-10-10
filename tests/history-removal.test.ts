import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { track, getTracking } from '../src/lib/core/tracking/service.server';
import { removeHistory, removeTraktHistory } from '../src/lib/sync/history-removal.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const [owner, other, movie, another] = Array.from({ length: 4 }, () => crypto.randomUUID());
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .insert(s.users)
    .values(
      [owner, other].map((id) => ({ id, username: `history-${id}`, passwordHash: 'fixture' }))
    );
  await getDb()
    .insert(s.media)
    .values(
      [movie, another].map((id) => ({ id, kind: 'movie' as const, title: 'Removal fixture' }))
    );
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .delete(s.users)
    .where(inArray(s.users.id, [owner, other]));
  await getDb()
    .delete(s.media)
    .where(inArray(s.media.id, [movie, another]));
});
const input = (eventIds: string[], extra = {}) => ({
  eventIds,
  expectedCount: eventIds.length,
  before: new Date().toISOString(),
  ...extra,
});

run(
  'removal is scoped, rebuilds remaining watches and cannot reimport removed identities',
  async () => {
    const first = await track(owner, {
      mediaId: movie,
      action: 'watch',
      source: 'trakt',
      sourceEventId: 'fixture:history:1',
      occurredAt: '2025-01-01T12:00:00.000Z',
    });
    const second = await track(owner, {
      mediaId: movie,
      action: 'watch',
      rewatch: true,
      occurredAt: '2025-02-01T12:00:00.000Z',
    });
    await track(owner, { mediaId: movie, action: 'favourite', value: true });
    await track(owner, { mediaId: movie, action: 'watchlist', value: true });
    const foreign = await track(other, { mediaId: movie, action: 'watch' });
    const elsewhere = await track(owner, { mediaId: another, action: 'watch' });
    await expect(removeHistory(owner, movie, input([foreign.eventId!]))).rejects.toThrow(
      'outside this title'
    );
    await expect(removeHistory(owner, movie, input([elsewhere.eventId!]))).rejects.toThrow(
      'outside this title'
    );
    await expect(
      removeHistory(owner, movie, input([first.eventId!], { expectedCount: 2 }))
    ).rejects.toThrow('History changed');
    expect((await getTracking(owner, movie)).playCount).toBe(2);
    expect(await removeHistory(owner, movie, input([first.eventId!]))).toEqual({
      removed: 1,
      queued: 0,
    });
    const state = await getTracking(owner, movie);
    expect(state.playCount).toBe(1);
    expect(state.watched).toBe(true);
    expect(state.lastWatchedAt?.toISOString()).toBe('2025-02-01T12:00:00.000Z');
    expect(state.favourite).toBe(true);
    expect(state.watchlist).toBe(true);
    expect(
      (
        await track(owner, {
          mediaId: movie,
          action: 'watch',
          source: 'trakt',
          sourceEventId: 'fixture:history:1',
        })
      ).duplicate
    ).toBe(true);
    expect((await getTracking(other, movie)).watched).toBe(true);
    await removeHistory(owner, movie, input([second.eventId!]));
    expect((await getTracking(owner, movie)).lastWatchedAt).toBeNull();
    expect((await getTracking(owner, movie)).playCount).toBe(0);
  }
);

run(
  'select all respects exclusions and snapshot; progress removal preserves imported cumulative play counts',
  async () => {
    const a = await track(owner, { mediaId: movie, action: 'progress', positionSeconds: 10 });
    const b = await track(owner, { mediaId: movie, action: 'progress', positionSeconds: 20 });
    await getDb()
      .update(s.trackingState)
      .set({ playCount: 5 })
      .where(and(eq(s.trackingState.userId, owner), eq(s.trackingState.mediaId, movie)));
    const before = new Date().toISOString();
    const c = await track(owner, { mediaId: movie, action: 'progress', positionSeconds: 30 });
    // Explicit timestamps avoid relying on clock resolution in the snapshot assertion.
    await getDb()
      .update(s.trackingEvents)
      .set({ createdAt: new Date(Date.parse(before) + 1000) })
      .where(eq(s.trackingEvents.id, c.eventId!));
    await removeHistory(
      owner,
      movie,
      input([], { all: true, excludedIds: [a.eventId!], before, expectedCount: 1 })
    );
    const events = await getDb()
      .select()
      .from(s.trackingEvents)
      .where(and(eq(s.trackingEvents.userId, owner), eq(s.trackingEvents.mediaId, movie)));
    expect(events.some((e) => e.id === b.eventId)).toBe(false);
    expect(events.some((e) => e.id === a.eventId)).toBe(true);
    expect(events.some((e) => e.id === c.eventId)).toBe(true);
    expect((await getTracking(owner, movie)).positionSeconds).toBe(30);
    expect((await getTracking(owner, movie)).playCount).toBe(5);
  }
);

run(
  'collection removal rebuilds show aggregates and queues exact provider corrections atomically',
  async () => {
    const [show, season, episode, collection, instance, connection] = Array.from(
      { length: 6 },
      () => crypto.randomUUID()
    );
    const db = getDb();
    await db.insert(s.media).values([
      { id: show, kind: 'show', title: 'History show' },
      { id: season, kind: 'season', title: 'History season' },
      { id: episode, kind: 'episode', title: 'History episode' },
      { id: collection, kind: 'collection', title: 'History collection' },
    ]);
    try {
      await db.insert(s.shows).values({ mediaId: show });
      await db.insert(s.seasons).values({ mediaId: season, showId: show, seasonNumber: 1 });
      await db
        .insert(s.episodes)
        .values({
          mediaId: episode,
          showId: show,
          seasonId: season,
          seasonNumber: 1,
          episodeNumber: 1,
        });
      await db
        .insert(s.mediaRelationships)
        .values({ parentId: collection, childId: show, kind: 'collection', position: 0 });
      await db
        .insert(s.providerInstances)
        .values({
          id: instance,
          provider: 'trakt',
          name: 'History fixture',
          baseUrl: 'https://api.trakt.tv',
        });
      await db
        .insert(s.providerConnections)
        .values({ id: connection, instanceId: instance, userId: owner });
      const watched = await track(owner, {
        mediaId: episode,
        action: 'watch',
        occurredAt: '2025-03-01T00:00:00.000Z',
      });
      const [pending] = await db
        .insert(s.outboxActions)
        .values({
          userId: owner,
          connectionId: connection,
          kind: 'trakt.export',
          payload: { eventId: watched.eventId },
        })
        .returning();
      expect((await getTracking(owner, show)).watched).toBe(true);
      expect(
        await removeHistory(owner, collection, input([], { all: true, expectedCount: 1 }))
      ).toEqual({ removed: 1, queued: 1 });
      const state = await getTracking(owner, show);
      expect(state.watched).toBe(false);
      expect(state.completedEpisodes).toBe(0);
      expect(state.lastWatchedAt).toBeNull();
      const actions = await db
        .select()
        .from(s.outboxActions)
        .where(eq(s.outboxActions.connectionId, connection));
      expect(actions.find((action) => action.id === pending.id)?.state).toBe('cancelled');
      const correction = actions.find((action) => action.kind === 'history.remove');
      expect(correction?.state).toBe('pending');
      expect(correction?.payload.mediaId).toBe(episode);
      expect(correction?.payload.events).toEqual([
        {
          action: 'watch',
          source: 'coast',
          sourceEventId: null,
          occurredAt: '2025-03-01T00:00:00.000Z',
        },
      ]);
    } finally {
      await db.delete(s.outboxActions).where(eq(s.outboxActions.connectionId, connection));
      await db.delete(s.providerInstances).where(eq(s.providerInstances.id, instance));
      await db.delete(s.media).where(inArray(s.media.id, [show, season, episode, collection]));
    }
  }
);

test('Trakt removal uses exact history IDs and fails ambiguous matching before any deletion', async () => {
  const writes: unknown[] = [];
  let matches = [{ id: 73, watched_at: '2025-01-01T12:00:00.000Z' }];
  const adapter = {
    write: async (...args: unknown[]) => {
      writes.push(args);
    },
    historyFor: async () => matches,
  } as unknown as Parameters<typeof removeTraktHistory>[0];
  const event = {
    action: 'watch',
    source: 'coast',
    sourceEventId: null,
    occurredAt: '2025-01-01T12:00:00.000Z',
  };
  await removeTraktHistory(adapter, 'connection', 'movie', { trakt: 9 }, [
    event,
    { ...event, source: 'trakt', sourceEventId: 'connection:history:42' },
  ]);
  expect(writes).toEqual([['history', { ids: [73, 42] }, true]]);
  writes.length = 0;
  matches = [...matches, { ...matches[0], id: 74 }];
  await expect(
    removeTraktHistory(adapter, 'connection', 'movie', { trakt: 9 }, [event])
  ).rejects.toThrow('Multiple Trakt watches');
  expect(writes).toHaveLength(0);
  await expect(
    removeTraktHistory(adapter, 'connection', 'movie', { trakt: 9 }, [
      { ...event, occurredAt: null },
    ])
  ).rejects.toThrow('no date');
  matches = [];
  await removeTraktHistory(adapter, 'connection', 'movie', { trakt: 9 }, [event]);
  expect(writes).toHaveLength(0);
});
