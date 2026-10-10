import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {
  addListItem,
  createList,
  getList,
  moveListItem,
  removeListItem,
} from '../src/lib/core/lists/service.server';
import {
  nextSequenceEntry,
  restartPlaylist,
  sequenceEntries,
} from '../src/lib/core/lists/sequence.server';
import { track } from '../src/lib/core/tracking/service.server';
import { deleteListWithExports } from '../src/lib/sync/trakt-lists.server';
import { bulkTrack } from '../src/lib/core/tracking/service.server';
import { setRewatch } from '../src/lib/core/tracking/rewatch.server';
import { mediaViewsForIds, sequenceNextView } from '../src/lib/server/queries/media';
import { continuationIds } from '../src/lib/server/queries/continuations';
import { listsData } from '../src/lib/server/queries/lists';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
let owner: string, other: string;
const [collection, nested, movie, show, season, ep1, ep2, special] = Array.from({ length: 8 }, () =>
  crypto.randomUUID()
);
const ids = [collection, nested, movie, show, season, ep1, ep2, special];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const people = await getDb()
    .insert(s.users)
    .values(
      ['owner', 'other'].map((name) => ({
        username: `sequence-${name}-${crypto.randomUUID()}`,
        passwordHash: 'fixture',
      }))
    )
    .returning();
  [owner, other] = people.map((row) => row.id);
  await getDb()
    .insert(s.media)
    .values([
      ...[collection, nested].map((id) => ({
        id,
        kind: 'collection' as const,
        title: 'Mixed collection',
      })),
      { id: movie, kind: 'movie', title: 'Movie', runtimeMinutes: 90 },
      { id: show, kind: 'show', title: 'Show' },
      { id: season, kind: 'season', title: 'Season' },
      ...[ep1, ep2, special].map((id) => ({ id, kind: 'episode' as const, title: 'Episode' })),
    ]);
  await getDb().insert(s.shows).values({ mediaId: show });
  await getDb().insert(s.seasons).values({ mediaId: season, showId: show, seasonNumber: 1 });
  await getDb()
    .insert(s.episodes)
    .values(
      [ep1, ep2, special].map((mediaId, i) => ({
        mediaId,
        showId: show,
        seasonId: season,
        seasonNumber: i === 2 ? 0 : 1,
        episodeNumber: i + 1,
        isSpecial: i === 2,
        runtimeMinutes: 30,
      }))
    );
  await getDb()
    .insert(s.mediaRelationships)
    .values([
      ...[special, movie, season, nested].map((childId, position) => ({
        parentId: collection,
        childId,
        position,
        kind: 'collection' as const,
      })),
      { parentId: nested, childId: collection, position: 0, kind: 'collection' },
    ]);
});
afterAll(async () => {
  if (!owner) return;
  await getDb()
    .delete(s.users)
    .where(inArray(s.users.id, [owner, other]));
  await getDb().delete(s.media).where(inArray(s.media.id, ids));
});
run(
  'mixed sequences preserve explicit order, expand seasons, include explicit specials and stop cycles',
  async () => {
    const source = { kind: 'collection' as const, id: collection };
    const entries = await sequenceEntries(owner, source);
    expect(entries.map((entry) => entry.mediaId)).toEqual([special, movie, ep1, ep2]);
    expect(entries[2].duration).toBe(1800);
    expect((await sequenceNextView(owner, source))?.id).toBe(special);
    expect((await sequenceNextView(owner, source))?.available).toBe(false);
    expect(nextSequenceEntry(entries, entries[0].entryId)?.mediaId).toBe(movie);
    expect(() => nextSequenceEntry(entries, 'removed')).toThrow();
    await track(owner, {
      mediaId: ep1,
      action: 'watch',
      occurredAt: '2020-01-01T00:00:00.000Z',
      acknowledged: true,
    });
    const planned = await continuationIds(owner, [ep1], false);
    expect(planned.sequenceNext.some((next) => next.source.id === collection)).toBe(true);
    await setRewatch(owner, { mediaId: collection, startedAt: '2025-01-01T00:00:00.000Z' });
    expect(
      (await sequenceEntries(owner, source)).find((entry) => entry.mediaId === ep1)?.watched
    ).toBe(false);
    expect((await mediaViewsForIds(owner, [ep1]))[0].watched).toBe(true);
    await bulkTrack(owner, {
      mediaId: collection,
      action: 'watch',
      acknowledged: true,
      includeSpecials: true,
    });
    expect((await sequenceEntries(owner, source)).every((entry) => entry.watched)).toBe(true);
  }
);
run(
  'playlist repetitions retain independent completion, progress and identity after moving or removing entries',
  async () => {
    const list = await createList(other, { name: 'Repeat sequence', playlist: true });
    for (const mediaId of [movie, season, movie]) await addListItem(other, list.id, mediaId);
    await restartPlaylist(other, list.id);
    const source = { kind: 'playlist' as const, id: list.id };
    let entries = await sequenceEntries(other, source);
    expect(entries.map((entry) => entry.mediaId)).toEqual([movie, ep1, ep2, movie]);
    expect(new Set(entries.map((entry) => entry.entryId)).size).toBe(4);
    const first = entries[0],
      repeated = entries[3];
    await track(other, {
      mediaId: movie,
      action: 'progress',
      positionSeconds: 45,
      durationSeconds: 5400,
      sequence: { ...source, entryId: repeated.entryId },
    });
    entries = await sequenceEntries(other, source);
    expect(entries[0].progress).toBe(0);
    expect(entries[3].progress).toBe(45);
    await track(other, {
      mediaId: movie,
      action: 'watch',
      acknowledged: true,
      sequence: { ...source, entryId: repeated.entryId },
    });
    entries = await sequenceEntries(other, source);
    expect(entries[0].watched).toBe(false);
    expect(entries[3].watched).toBe(true);
    expect(
      (await sequenceNextView(other, source, undefined, repeated.entryId))?.sequence?.entryId
    ).toBe(repeated.entryId);
    const rows = await listsData(other, { view: list.id });
    expect(rows.items.map((item) => item.entryId)).toEqual(
      (await getList(other, list.id)).items.map((item) => item.entryId)
    );
    expect(rows.items[0].watched).toBe(false);
    expect(rows.items[2].watched).toBe(true);
    await moveListItem(other, list.id, { entryId: repeated.entryId, direction: -1 });
    entries = await sequenceEntries(other, source);
    expect(entries[1].entryId).toBe(repeated.entryId);
    expect(entries[1].watched).toBe(true);
    await removeListItem(other, list.id, first.entryId);
    expect(
      (await getList(other, list.id)).items.filter((entry) => entry.item.id === movie)
    ).toHaveLength(1);
    expect((await sequenceEntries(other, source))[0].watched).toBe(true);
    await expect(sequenceEntries(owner, source)).rejects.toThrow();
    await expect(
      track(owner, {
        mediaId: movie,
        action: 'watch',
        sequence: { ...source, entryId: repeated.entryId },
      })
    ).rejects.toThrow();
    const history = await getDb()
      .select()
      .from(s.trackingEvents)
      .where(eq(s.trackingEvents.userId, other));
    await restartPlaylist(other, list.id);
    expect((await sequenceEntries(other, source))[0].watched).toBe(false);
    expect(
      (await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId, other)))
        .length
    ).toBe(history.length);
    const regular = await createList(other, { name: 'Regular list' });
    await addListItem(other, regular.id, movie);
    await addListItem(other, regular.id, movie);
    expect((await getList(other, regular.id)).items).toHaveLength(1);
    expect(await deleteListWithExports(other, list.id)).toEqual({ deleted: true });
    await expect(getList(other, list.id)).rejects.toThrow();
  }
);
