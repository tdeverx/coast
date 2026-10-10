import { beforeAll, afterAll, test, expect } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, getSql } from '../src/lib/server/db';
import {
  users,
  media,
  movies,
  shows,
  seasons,
  episodes,
  externalIds,
  providerInstances,
  providerConnections,
  outboxActions,
  trackingEvents,
  trackingState,
  notifications,
} from '../src/lib/server/db/schema';
import { trackWithExports, bulkTrackWithExports, rateWithExports } from '../src/lib/sync/changes.server';
import { track } from '../src/lib/core/tracking/service.server';
import { getPendingConflicts, resolveConflict } from '../src/lib/sync/conflicts.server';
const enabled = process.env.COAST_DB_TEST === '1',
  run = enabled ? test : test.skip;
const suffix = crypto.randomUUID();
let userId: string,
  otherId: string,
  instanceId: string,
  movieId: string,
  showId: string,
  seasonId: string,
  failedId: string;
let episodeIds: string[] = [];
beforeAll(async () => {
  if (!enabled) return;
  const people = await getDb()
    .insert(users)
    .values([
      { username: `sync-${suffix}`, passwordHash: 'synthetic' },
      { username: `sync-other-${suffix}`, passwordHash: 'synthetic' },
    ])
    .returning();
  userId = people[0].id;
  otherId = people[1].id;
  const [instance] = await getDb()
    .insert(providerInstances)
    .values({
      provider: 'trakt',
      name: 'Sync fixture',
      baseUrl: 'https://api.trakt.tv',
      settings: { approved: true },
    })
    .returning();
  instanceId = instance.id;
  await getDb()
    .insert(providerConnections)
    .values({
      userId,
      instanceId,
      externalUserId: 'fixture',
      status: 'connected',
      settings: { sync: { history: true, ratings: true, collection: false, watchlist: false } },
    });
  const [movie] = await getDb()
    .insert(media)
    .values({ kind: 'movie', title: 'Sync fixture', runtimeMinutes: 60 })
    .returning();
  movieId = movie.id;
  await getDb().insert(movies).values({ mediaId: movieId });
  await getDb()
    .insert(externalIds)
    .values({
      mediaId: movieId,
      provider: 'trakt',
      externalId: `movie-${suffix}`,
      mediaKind: 'movie',
    });
  const [show] = await getDb()
    .insert(media)
    .values({ kind: 'show', title: 'Bulk fixture' })
    .returning();
  showId = show.id;
  await getDb().insert(shows).values({ mediaId: showId });
  const [season] = await getDb()
    .insert(media)
    .values({ kind: 'season', title: 'Season 1' })
    .returning();
  seasonId = season.id;
  await getDb().insert(seasons).values({ mediaId: seasonId, showId, seasonNumber: 1 });
  for (let number = 1; number <= 2; number++) {
    const [episode] = await getDb()
      .insert(media)
      .values({ kind: 'episode', title: `Episode ${number}` })
      .returning();
    episodeIds.push(episode.id);
    await getDb()
      .insert(episodes)
      .values({ mediaId: episode.id, showId, seasonId, seasonNumber: 1, episodeNumber: number });
    await getDb()
      .insert(externalIds)
      .values({
        mediaId: episode.id,
        provider: 'trakt',
        externalId: `episode-${number}-${suffix}`,
        mediaKind: 'episode',
      });
  }
  const [failed] = await getDb()
    .insert(media)
    .values({ kind: 'movie', title: 'Rollback fixture' })
    .returning();
  failedId = failed.id;
  await getDb().insert(movies).values({ mediaId: failedId });
  await getDb()
    .insert(externalIds)
    .values({
      mediaId: failedId,
      provider: 'trakt',
      externalId: `failed-${suffix}`,
      mediaKind: 'movie',
    });
});
afterAll(async () => {
  if (!enabled) return;
  await getSql().unsafe('DROP TRIGGER IF EXISTS provider_test_outbox_failure ON outbox_actions');
  await getSql().unsafe('DROP FUNCTION IF EXISTS provider_test_outbox_failure()');
  if (userId)
    await getDb()
      .delete(users)
      .where(inArray(users.id, [userId, otherId]));
  if (instanceId)
    await getDb().delete(providerInstances).where(eq(providerInstances.id, instanceId));
  if (movieId)
    await getDb()
      .delete(media)
      .where(inArray(media.id, [movieId, showId, seasonId, failedId, ...episodeIds]));
});
run('a no-op watch never queues duplicate history; category opt-outs stay local', async () => {
  expect((await trackWithExports(userId, { mediaId: movieId, action: 'watch' })).changed).toBe(
    true
  );
  expect((await trackWithExports(userId, { mediaId: movieId, action: 'watch' })).changed).toBe(
    false
  );
  await trackWithExports(userId, { mediaId: movieId, action: 'collect', value: true });
  const actions = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(eq(outboxActions.userId, userId), sql`${outboxActions.payload}->>'mediaId'=${movieId}`)
    );
  expect(actions).toHaveLength(1);
  expect(actions[0].payload.category).toBe('history');
  expect(actions[0].payload.eventId).toBeString();
});
run('bulk history exports exactly the newly changed canonical episode events', async () => {
  const result = await bulkTrackWithExports(userId, { mediaId: showId, action: 'watch' });
  expect(result.changed).toBe(2);
  expect(result.events.map((event) => event.mediaId).sort()).toEqual([...episodeIds].sort());
  const actions = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(
        eq(outboxActions.userId, userId),
        sql`${outboxActions.payload}->>'mediaId' in (${episodeIds[0]},${episodeIds[1]},${showId})`
      )
    );
  expect(actions).toHaveLength(2);
  expect(actions.some((action) => action.payload.mediaId === showId)).toBe(false);
  expect(
    (await bulkTrackWithExports(userId, { mediaId: showId, action: 'watch' })).events
  ).toHaveLength(0);
});
run('bulk progress reset does not emit watch-history exports', async () => {
  await trackWithExports(userId, {
    mediaId: episodeIds[0],
    action: 'progress',
    positionSeconds: 30,
    acknowledged: true,
  });
  const before = await getDb().select().from(outboxActions).where(eq(outboxActions.userId, userId));
  const result = await bulkTrackWithExports(userId, {
    mediaId: showId,
    action: 'progress',
    acknowledged: true,
  });
  expect(result.changed).toBe(1);
  expect(
    await getDb().select().from(outboxActions).where(eq(outboxActions.userId, userId))
  ).toHaveLength(before.length);
});
run('rating no-ops do not export and a replacement compacts obsolete pending edits', async () => {
  await rateWithExports(userId, { mediaId: movieId, value: 5 });
  const [original] = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(eq(outboxActions.userId, userId), sql`${outboxActions.payload}->>'category'='ratings'`)
    );
  const [notice] = await getDb()
    .insert(notifications)
    .values({
      userId,
      kind: 'external-action',
      title: 'Waiting for a connected service',
      sourceKey: `outbox:${original.id}`,
    })
    .returning();
  await rateWithExports(userId, { mediaId: movieId, value: 5 });
  await rateWithExports(userId, { mediaId: movieId, value: 4.5 });
  const actions = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(eq(outboxActions.userId, userId), sql`${outboxActions.payload}->>'category'='ratings'`)
    );
  expect(actions).toHaveLength(2);
  expect(actions.filter((action) => action.state === 'pending')).toHaveLength(1);
  expect(actions.find((action) => action.state === 'pending')?.payload.value).toBe(4.5);
  expect(
    await getDb().select().from(notifications).where(eq(notifications.id, notice.id))
  ).toHaveLength(0);
});
run('failed outbound insertion rolls back the canonical change and its history event', async () => {
  await getSql().unsafe(
    `CREATE FUNCTION provider_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'mediaId' = '${failedId}' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$`
  );
  await getSql().unsafe(
    'CREATE TRIGGER provider_test_outbox_failure BEFORE INSERT ON outbox_actions FOR EACH ROW EXECUTE FUNCTION provider_test_outbox_failure()'
  );
  try {
    await expect(
      trackWithExports(userId, { mediaId: failedId, action: 'watch' })
    ).rejects.toThrow();
    expect(
      await getDb().select().from(trackingEvents).where(eq(trackingEvents.mediaId, failedId))
    ).toHaveLength(0);
    expect(
      await getDb().select().from(trackingState).where(eq(trackingState.mediaId, failedId))
    ).toHaveLength(0);
  } finally {
    await getSql().unsafe('DROP TRIGGER provider_test_outbox_failure ON outbox_actions');
    await getSql().unsafe('DROP FUNCTION provider_test_outbox_failure()');
  }
});
run(
  'conflict review preserves evidence, isolates users and applies acceptance exactly once',
  async () => {
    const first = await track(userId, {
      mediaId: movieId,
      action: 'unwatch',
      source: 'trakt',
      sourceEventId: `conflict-ignore-${suffix}`,
    });
    expect(first.reviewRequired).toBe(true);
    expect((await getPendingConflicts(userId)).some((event) => event.id === first.eventId)).toBe(
      true
    );
    await expect(resolveConflict(otherId, first.eventId!, 'accepted')).rejects.toThrow('not found');
    await resolveConflict(userId, first.eventId!, 'ignored');
    expect(
      (
        await track(userId, {
          mediaId: movieId,
          action: 'unwatch',
          source: 'trakt',
          sourceEventId: `conflict-ignore-${suffix}`,
        })
      ).reviewRequired
    ).toBe(false);
    const second = await track(userId, {
      mediaId: movieId,
      action: 'unwatch',
      source: 'trakt',
      sourceEventId: `conflict-accept-${suffix}`,
    });
    expect(second.reviewRequired).toBe(true);
    await resolveConflict(userId, second.eventId!, 'accepted');
    expect((await resolveConflict(userId, second.eventId!, 'accepted')).alreadyReviewed).toBe(true);
    const [evidence] = await getDb()
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.id, second.eventId!));
    expect(evidence.applied).toBe(false);
    expect(evidence.reviewDecision).toBe('accepted');
    expect(await getPendingConflicts(userId)).toHaveLength(0);
    const reviews = await getDb()
      .select()
      .from(trackingEvents)
      .where(and(eq(trackingEvents.userId, userId), eq(trackingEvents.source, 'coast-review')));
    expect(reviews).toHaveLength(1);
    const [state] = await getDb()
      .select()
      .from(trackingState)
      .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, movieId)));
    expect(state.watched).toBe(false);
  }
);
