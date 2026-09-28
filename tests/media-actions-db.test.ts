import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {
  mediaActionData,
  mediaHistory,
  mediaActivity,
} from '../src/lib/server/queries/media-actions';
import { bulkTrack, getTracking, track } from '../src/lib/core/tracking/service';
import { createList, addListItem, getList, removeListItem } from '../src/lib/core/lists/service';
import { sequenceEntries } from '../src/lib/core/lists/sequence';
import { changeContinue, wholeWorkId } from '../src/lib/core/tracking/continue';
import { setRewatch } from '../src/lib/core/tracking/rewatch';
import { requestList } from '../src/lib/server/queries/requests';
import { mediaViewsForIds } from '../src/lib/server/queries/media';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const [owner, other, show, season, specials, ep1, ep2, special, movie, collection] = Array.from(
  { length: 10 },
  () => crypto.randomUUID()
);
const ids = [show, season, specials, ep1, ep2, special, movie, collection];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .insert(s.users)
    .values([owner, other].map((id) => ({ id, username: `menu-${id}`, passwordHash: 'fixture' })));
  await getDb()
    .insert(s.media)
    .values([
      { id: show, kind: 'show', title: 'Menu show' },
      ...[season, specials].map((id) => ({
        id,
        kind: 'season' as const,
        title: id === season ? 'Named season' : 'Specials',
      })),
      ...[ep1, ep2, special].map((id) => ({ id, kind: 'episode' as const, title: 'Menu episode' })),
      { id: movie, kind: 'movie', title: 'Menu movie' },
      { id: collection, kind: 'collection', title: 'Menu collection' },
    ]);
  await getDb().insert(s.shows).values({ mediaId: show });
  await getDb()
    .insert(s.seasons)
    .values(
      [season, specials].map((mediaId, i) => ({
        mediaId,
        showId: show,
        seasonNumber: i === 0 ? 1 : 0,
      }))
    );
  await getDb()
    .insert(s.episodes)
    .values(
      [ep1, ep2, special].map((mediaId, i) => ({
        mediaId,
        showId: show,
        seasonId: i === 2 ? specials : season,
        seasonNumber: i === 2 ? 0 : 1,
        episodeNumber: i + 1,
        isSpecial: i === 2,
      }))
    );
  await getDb()
    .insert(s.mediaRelationships)
    .values([
      { parentId: collection, childId: show, kind: 'collection', position: 0 },
      { parentId: collection, childId: movie, kind: 'collection', position: 1 },
    ]);
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .delete(s.users)
    .where(inArray(s.users.id, [owner, other]));
  await getDb().delete(s.media).where(inArray(s.media.id, ids));
});
run(
  'menu targets navigate show, season, episode and collection; memberships remain private',
  async () => {
    expect((await mediaActionData(owner, show)).children.map((i) => i.id)).toEqual([
      specials,
      season,
    ]);
    expect((await mediaActionData(owner, season)).children.map((i) => i.id)).toEqual([ep1, ep2]);
    const episode = await mediaActionData(owner, ep1);
    expect(episode.targets.map((i) => i.id).sort()).toEqual([ep1, season, show].sort());
    expect(episode.requestTarget?.id).toBe(show);
    const showActions = await mediaActionData(owner, show);
    expect(showActions.playable).toBeNull();
    expect((await mediaActionData(owner, collection)).children.map((i) => i.id)).toEqual([
      show,
      movie,
    ]);
    const list = await createList(owner, { name: 'Created with title', mediaId: movie });
    expect((await getList(owner, list.id)).items.map((i) => i.item.id)).toEqual([movie]);
    expect(
      (await mediaActionData(owner, movie)).lists.find((i) => i.id === list.id)?.entries
    ).toHaveLength(1);
    expect((await mediaActionData(other, movie)).lists).toHaveLength(0);
    await expect(
      createList(owner, { name: 'Invalid item', mediaId: crypto.randomUUID() })
    ).rejects.toThrow();
    expect(
      await getDb()
        .select()
        .from(s.lists)
        .where(and(eq(s.lists.userId, owner), eq(s.lists.name, 'Invalid item')))
    ).toHaveLength(0);
  }
);
run(
  'dated bulk watches, explicit specials, progress resets and group history preserve scope',
  async () => {
    await bulkTrack(owner, {
      mediaId: show,
      action: 'watch',
      occurredAt: '2020-01-01T00:00:00.000Z',
      rewatch: true,
      acknowledged: true,
    });
    expect((await getTracking(owner, special)).watched).toBe(false);
    await bulkTrack(owner, { mediaId: specials, action: 'watch', acknowledged: true });
    expect((await getTracking(owner, special)).watched).toBe(true);
    await track(owner, {
      mediaId: ep1,
      action: 'progress',
      positionSeconds: 30,
      acknowledged: true,
    });
    const progressActions = await mediaActionData(owner, show);
    expect(progressActions.progressTargetIds).toContain(show);
    expect(progressActions.progressTargetIds).toContain(season);
    expect((await mediaActionData(other, show)).progressTargetIds).toEqual([]);
    const count = (await getTracking(owner, ep1)).playCount;
    await getDb()
      .insert(s.editionProgress)
      .values({ userId: owner, mediaId: ep1, editionId: 'test-edition', positionSeconds: 30 });
    await bulkTrack(owner, { mediaId: season, action: 'progress', acknowledged: true });
    expect((await getTracking(owner, ep1)).positionSeconds).toBe(0);
    expect(
      await getDb()
        .select()
        .from(s.editionProgress)
        .where(and(eq(s.editionProgress.userId, owner), eq(s.editionProgress.mediaId, ep1)))
    ).toHaveLength(0);
    expect((await getTracking(owner, ep1)).watched).toBe(true);
    expect((await getTracking(owner, ep1)).playCount).toBe(count);
    await track(other, { mediaId: ep1, action: 'watch', acknowledged: true });
    const history = await mediaHistory(owner, show);
    expect(history.items.some((i) => i.mediaId === special)).toBe(true);
    expect(history.items.filter((i) => i.action === 'watch')).toHaveLength(3);
    expect(
      history.items
        .filter((i) => i.rewatch)
        .every((i) => i.occurredAt === '2020-01-01T00:00:00.000Z')
    ).toBe(true);
    const activity = await mediaActivity(owner, show);
    expect(activity.total).toBe(history.total);
    expect(activity.items.map((item) => item.eventId)).toEqual(
      history.items.map((item) => item.id)
    );
    expect(activity.items.every((item) => item.captionTitle === 'Menu show')).toBe(true);
    expect((await mediaActivity(other, show)).total).toBe(1);
    expect((await mediaActivity(owner, collection)).total).toBe(history.total);
    expect((await mediaHistory(other, show)).total).toBe(1);
    expect((await mediaHistory(owner, collection)).total).toBe(history.total);
    await expect(
      bulkTrack(owner, { mediaId: show, action: 'watch', occurredAt: '2999-01-01T00:00:00.000Z' })
    ).rejects.toThrow();
    await getDb()
      .insert(s.trackingEvents)
      .values(
        Array.from({ length: 65 }, () => ({
          userId: owner,
          mediaId: movie,
          action: 'watch' as const,
          source: 'coast' as const,
          occurredAt: new Date('2010-01-01'),
        }))
      );
    expect((await mediaHistory(owner, movie)).items).toHaveLength(60);
    expect((await mediaHistory(owner, movie, 2)).items).toHaveLength(5);
  }
);
run('season rewatch only resets that season and never deletes history', async () => {
  const before = (await mediaHistory(owner, show)).total;
  await setRewatch(owner, { mediaId: season, startedAt: new Date().toISOString() });
  const views = await mediaViewsForIds(owner, [ep1, ep2, special]);
  expect(views.filter((i) => i.id !== special).every((i) => !i.watched && i.rewatchStartedAt)).toBe(
    true
  );
  expect(views.find((i) => i.id === special)?.watched).toBe(true);
  expect((await mediaActionData(owner, ep1)).ownRewatchStartedAt).toBeNull();
  expect((await mediaActionData(owner, season)).ownRewatchStartedAt).toBeTruthy();
  expect((await mediaActionData(owner, ep1)).rewatchTargetIds).toEqual([season]);
  expect((await mediaActionData(other, ep1)).rewatchTargetIds).toEqual([]);
  expect((await mediaHistory(owner, show)).total).toBe(before);
  await setRewatch(owner, { mediaId: season, startedAt: null });
});
run('bulk playlist season tracking only changes the selected repeated occurrence', async () => {
  const list = await createList(other, {
    name: 'Repeated season',
    playlist: true,
    mediaId: season,
  });
  await addListItem(other, list.id, season);
  const source = { kind: 'playlist' as const, id: list.id };
  const roots = (await getList(other, list.id)).items;
  await bulkTrack(other, {
    mediaId: season,
    action: 'watch',
    acknowledged: true,
    sequence: { ...source, entryId: roots[1].entryId },
  });
  const entries = await sequenceEntries(other, source);
  expect(
    entries.filter((i) => i.entryId.startsWith(roots[0].entryId + '/')).every((i) => !i.watched)
  ).toBe(true);
  expect(
    entries.filter((i) => i.entryId.startsWith(roots[1].entryId + '/')).every((i) => i.watched)
  ).toBe(true);
});

run('menu undo data preserves queue membership and ordinary-list ordering', async () => {
  await getDb()
    .insert(s.upNext)
    .values([
      { userId: owner, mediaId: ep2 },
      { userId: owner, mediaId: show },
    ])
    .onConflictDoNothing();
  const before = (await getTracking(owner, ep2)).playCount;
  const dropped = await track(owner, { mediaId: ep2, action: 'drop', acknowledged: true });
  expect(dropped.removedQueueIds?.sort()).toEqual([ep2, show].sort());
  await track(owner, { mediaId: ep2, action: 'restore', acknowledged: true });
  expect((await getTracking(owner, ep2)).playCount).toBe(before);
  expect((await getTracking(owner, ep2)).dropped).toBe(false);
  const list = await createList(owner, { name: 'Undo membership order' });
  const first = await addListItem(owner, list.id, movie);
  await addListItem(owner, list.id, ep2);
  expect((await addListItem(owner, list.id, movie)).added).toBe(false);
  await removeListItem(owner, list.id, first.entryId);
  await addListItem(owner, list.id, movie, 0);
  expect((await getList(owner, list.id)).items.map((row) => row.item.id)).toEqual([movie, ep2]);
  const preferences = await mediaActionData(owner, movie);
  expect(preferences.hasPersonalOverrides).toBe(false);
  await getDb()
    .insert(s.userMetadataPreferences)
    .values({ userId: owner, mediaId: movie, title: 'Personal title' });
  expect((await mediaActionData(owner, movie)).hasPersonalOverrides).toBe(true);
  expect((await mediaActionData(other, movie)).hasPersonalOverrides).toBe(false);
});

run(
  'Continue removal ends the whole-show rewatch and Undo restores it without erasing history',
  async () => {
    expect(await wholeWorkId(getDb(), ep1)).toBe(show);
    expect(await wholeWorkId(getDb(), season)).toBe(show);
    const before = await mediaHistory(owner, show);
    const startedAt = '2024-01-01T00:00:00.000Z';
    await setRewatch(owner, { mediaId: show, startedAt });
    const removed = await changeContinue(owner, { mediaId: ep1, action: 'remove' });
    expect(removed.mediaId).toBe(show);
    expect((await mediaActionData(owner, show)).ownRewatchStartedAt).toBeNull();
    expect((await getTracking(owner, show)).dropped).toBe(true);
    await changeContinue(owner, {
      mediaId: show,
      action: 'undo',
      eventId: removed.eventId,
      previous: removed.previous,
    });
    expect((await mediaActionData(owner, show)).ownRewatchStartedAt).toBe(startedAt);
    expect((await getTracking(owner, show)).dropped).toBe(false);
    const after = await mediaHistory(owner, show);
    expect(after.total).toBe(before.total);
    expect((await mediaActionData(other, show)).ownRewatchStartedAt).toBeNull();
  }
);
run('air-date watches use each episode date and exclude unaired episodes', async () => {
  await getDb().update(s.media).set({ releaseDate: '2020-02-03' }).where(eq(s.media.id, ep1));
  await getDb().update(s.media).set({ releaseDate: '2999-02-04' }).where(eq(s.media.id, ep2));
  const result = await bulkTrack(owner, {
    mediaId: season,
    action: 'watch',
    onReleaseDate: true,
    rewatch: true,
    acknowledged: true,
  });
  expect(result.total).toBe(1);
  const event = (await mediaHistory(owner, ep1)).items.find(
    (row) => row.occurredAt === '2020-02-03T00:00:00.000Z'
  );
  expect(event?.action).toBe('watch');
  expect((await mediaActionData(owner, season)).hasReleaseDate).toBe(true);
  expect((await mediaActionData(owner, ep2)).hasReleaseDate).toBe(false);
});

run('collection Continue removal preserves member state and rejects stale Undo', async () => {
  await setRewatch(owner, { mediaId: collection, startedAt: '2024-01-01T00:00:00.000Z' });
  const member = await getTracking(owner, movie);
  const removal = await changeContinue(owner, { mediaId: collection, action: 'remove' });
  expect((await getTracking(owner, movie)).dropped).toBe(member.dropped);
  expect((await getTracking(owner, movie)).playCount).toBe(member.playCount);
  await changeContinue(owner, { mediaId: collection, action: 'add' });
  await expect(
    changeContinue(owner, {
      mediaId: collection,
      action: 'undo',
      eventId: removal.eventId,
      previous: removal.previous,
    })
  ).rejects.toThrow('changed since removal');
});

run('request menu management follows owner state and Seerr permissions', async () => {
  const db = getDb();
  const instanceId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  await db.insert(s.providerInstances).values({
    id: instanceId,
    provider: 'seerr',
    name: 'Menu test',
    baseUrl: 'http://localhost:5055',
  });
  try {
    await db.insert(s.providerConnections).values({
      userId: owner,
      instanceId,
      status: 'connected',
      settings: { seerrPermissions: 32 },
    });
    await db.insert(s.mediaRequests).values({
      id: requestId,
      userId: owner,
      mediaId: movie,
      instanceId,
      externalId: '42',
      state: 'pending',
      is4k: true,
    });
    let request = (await mediaActionData(owner, movie)).requests.find(
      (row) => row.id === requestId
    )!;
    expect(request).toMatchObject({
      is4k: true,
      canCancel: true,
      canApprove: false,
      canDecline: false,
    });
    expect((await mediaActionData(other, movie)).requests).toEqual([]);
    expect((await requestList(owner, 1, requestId)).requests.map((row) => row.id)).toEqual([
      requestId,
    ]);
    expect((await requestList(other, 1, requestId)).requests).toEqual([]);
    await expect(requestList(owner, 1, 'invalid')).rejects.toThrow();
    await db
      .update(s.mediaRequests)
      .set({ state: 'approved' })
      .where(eq(s.mediaRequests.id, requestId));
    expect((await mediaActionData(owner, movie)).requests[0].canCancel).toBe(false);
    await db
      .update(s.providerConnections)
      .set({ settings: { seerrPermissions: 16 } })
      .where(eq(s.providerConnections.instanceId, instanceId));
    expect((await mediaActionData(owner, movie)).requests[0].canCancel).toBe(true);
    await db
      .update(s.mediaRequests)
      .set({ state: 'pending' })
      .where(eq(s.mediaRequests.id, requestId));
    request = (await mediaActionData(owner, movie)).requests[0];
    expect(request).toMatchObject({ canApprove: true, canDecline: true });
    await db
      .update(s.providerConnections)
      .set({ status: 'disconnected' })
      .where(eq(s.providerConnections.instanceId, instanceId));
    expect((await mediaActionData(owner, movie)).requests[0]).toMatchObject({
      canCancel: false,
      canApprove: false,
      canDecline: false,
    });
    await db
      .update(s.mediaRequests)
      .set({ state: 'cancelled' })
      .where(eq(s.mediaRequests.id, requestId));
    expect((await mediaActionData(owner, movie)).requests).toEqual([]);
  } finally {
    await db.delete(s.mediaRequests).where(eq(s.mediaRequests.instanceId, instanceId));
    await db.delete(s.providerConnections).where(eq(s.providerConnections.instanceId, instanceId));
    await db.delete(s.providerInstances).where(eq(s.providerInstances.id, instanceId));
  }
});
