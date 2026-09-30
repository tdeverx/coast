import { afterAll, beforeAll, test, expect } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { updateProviderSchedule, runProviderJob, scheduleProviderMaintenance } from '../src/lib/providers/maintenance.server';
import { libraryData } from '../src/lib/server/queries/library';
import { ingestMetadata } from '../src/lib/catalogue/service';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const admin = crypto.randomUUID(),
  member = crypto.randomUUID(),
  disabled = crypto.randomUUID(),
  instance = crypto.randomUUID();
const connections = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const mediaIds: string[] = [];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .insert(s.users)
    .values([
      { id: admin, username: `maintenance-${admin}`, passwordHash: 'unused', role: 'admin' },
      { id: member, username: `maintenance-${member}`, passwordHash: 'unused' },
      { id: disabled, username: `maintenance-${disabled}`, passwordHash: 'unused', disabled: true },
    ]);
  await getDb()
    .insert(s.providerInstances)
    .values({
      id: instance,
      provider: 'jellyfin',
      name: 'Shared test integration',
      baseUrl: 'https://fixture.invalid',
      settings: { schedule: { enabled: true, intervalMinutes: 10, fullIntervalHours: 24 } },
    });
  await getDb()
    .insert(s.providerConnections)
    .values(
      [admin, member, disabled].map((userId, index) => ({
        id: connections[index],
        userId,
        instanceId: instance,
        status: 'connected' as const,
        settings: { schedule: { enabled: false, intervalMinutes: 999, fullIntervalHours: 999 } },
      }))
    );
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  if (mediaIds.length) await getDb().delete(s.media).where(inArray(s.media.id, mediaIds));
  await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id, instance));
  await getDb()
    .delete(s.users)
    .where(inArray(s.users.id, [admin, member, disabled]));
});
run('one admin schedule covers all active accounts and rejects user controls', async () => {
  await expect(
    updateProviderSchedule(member, instance, {
      enabled: true,
      intervalMinutes: 30,
      fullIntervalHours: 48,
    })
  ).rejects.toThrow('Administrator');
  await expect(runProviderJob(member, instance)).rejects.toThrow('Administrator');
  await updateProviderSchedule(admin, instance, {
    enabled: true,
    intervalMinutes: 30,
    fullIntervalHours: 48,
  });
  const result = await scheduleProviderMaintenance({ instanceId: instance });
  expect(result.queued).toBe(2);
  const jobs = await getDb()
    .select()
    .from(s.outboxActions)
    .where(inArray(s.outboxActions.connectionId, connections));
  expect(jobs.map((j) => j.userId).sort()).toEqual([admin, member].sort());
  expect(jobs.every((j) => j.kind === 'jellyfin.scan' && j.payload.full === true)).toBe(true);
  const again = await runProviderJob(admin, instance);
  expect(again.queued).toBe(0);
  expect(again.active).toBe(2);
  expect(
    (
      await getDb()
        .select()
        .from(s.outboxActions)
        .where(inArray(s.outboxActions.connectionId, connections))
    )
      .map((j) => j.id)
      .sort()
  ).toEqual(jobs.map((j) => j.id).sort());
});
run('paused schedules stay paused and recently checked accounts do not repeat work', async () => {
  await getDb().delete(s.outboxActions).where(inArray(s.outboxActions.connectionId, connections));
  await updateProviderSchedule(admin, instance, {
    enabled: false,
    intervalMinutes: 30,
    fullIntervalHours: 48,
  });
  expect((await scheduleProviderMaintenance({ instanceId: instance })).queued).toBe(0);
  await updateProviderSchedule(admin, instance, {
    enabled: true,
    intervalMinutes: 30,
    fullIntervalHours: 48,
  });
  await getDb()
    .insert(s.syncCheckpoints)
    .values(
      connections
        .slice(0, 2)
        .map((connectionId) => ({ connectionId, kind: 'jellyfin-full', completedAt: new Date() }))
    );
  expect((await scheduleProviderMaintenance({ instanceId: instance })).queued).toBe(0);
  const results = await Promise.all([
    runProviderJob(admin, instance),
    runProviderJob(admin, instance),
  ]);
  expect(results.reduce((n, r) => n + r.queued, 0)).toBe(2);
});
run('genre filtering uses resolved provider and override genres before counting', async () => {
  const marker = `genre-${crypto.randomUUID()}`;
  const movie = await ingestMetadata({
    provider: 'tmdb',
    externalId: marker,
    kind: 'movie',
    title: 'Genre fixture',
    genres: [marker],
  });
  mediaIds.push(movie.id);
  const data = await libraryData(member, { scope: 'all', genre: marker.toUpperCase() });
  expect(data.total).toBe(1);
  expect(data.items[0].id).toBe(movie.id);
  await getDb()
    .insert(s.metadataOverrides)
    .values({ mediaId: movie.id, genres: ['Overridden genre'] });
  expect((await libraryData(member, { scope: 'all', genre: marker })).total).toBe(0);
  expect(
    (await libraryData(member, { scope: 'all', genre: 'Overridden genre' })).items.some(
      (i) => i.id === movie.id
    )
  ).toBe(true);
});
