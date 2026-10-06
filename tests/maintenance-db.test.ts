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
      fullIntervalHours: 48, liveEnabled:true,
    })
  ).rejects.toThrow('Administrator');
  await expect(runProviderJob(member, instance)).rejects.toThrow('Administrator');
  await updateProviderSchedule(admin, instance, {
    enabled: true,
    intervalMinutes: 30,
    fullIntervalHours: 48, liveEnabled:true,
  });
  const result = await scheduleProviderMaintenance({ instanceId: instance });
  expect(result.queued).toBe(4);
  const jobs = await getDb()
    .select()
    .from(s.outboxActions)
    .where(inArray(s.outboxActions.connectionId, connections));
  expect(new Set(jobs.map((j) => j.userId)).size).toBe(1);
  expect(jobs.filter(j => j.kind === 'jellyfin.library')).toHaveLength(1);
  expect(jobs.filter(j => j.kind === 'jellyfin.sync')).toHaveLength(1);
  expect(jobs.filter(j => j.kind === 'jellyfin.streams')).toMatchObject([{userId:admin,connectionId:connections[0]}]);
  const again = await runProviderJob(admin, instance);
  expect(again.queued).toBe(0);
  expect(again.active).toBe(4);
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
run('one task per service rotates to the account checked least recently', async()=>{
 const jobs=await getDb().select().from(s.outboxActions).where(inArray(s.outboxActions.connectionId,connections));
 const job=jobs.find(j=>j.kind==='jellyfin.sync')!;
 await getDb().update(s.outboxActions).set({state:'succeeded',updatedAt:new Date()}).where(eq(s.outboxActions.id,job.id));
 await getDb().insert(s.syncCheckpoints).values({connectionId:job.connectionId!,kind:'jellyfin-user',completedAt:new Date()});
 expect((await scheduleProviderMaintenance({instanceId:instance})).queued).toBe(1);
 const other=connections.slice(0,2).find(id=>id!==job.connectionId)!;
 const pending=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.connectionId,other));
 expect(pending.filter(j=>j.kind==='jellyfin.sync'&&j.state==='pending')).toHaveLength(1);
 await getDb().delete(s.syncCheckpoints).where(eq(s.syncCheckpoints.connectionId,job.connectionId!));
});
run('paused schedules stay paused and recently checked accounts do not repeat work', async () => {
  await getDb().delete(s.outboxActions).where(inArray(s.outboxActions.connectionId, connections));
  await updateProviderSchedule(admin, instance, {
    enabled: false,
    intervalMinutes: 30,
    fullIntervalHours: 48, liveEnabled:false,
  });
  expect((await scheduleProviderMaintenance({ instanceId: instance })).queued).toBe(0);
  await updateProviderSchedule(admin, instance, {
    enabled: true,
    intervalMinutes: 30,
    fullIntervalHours: 48, liveEnabled:false,
  });
  await getDb()
    .insert(s.syncCheckpoints)
    .values(
      connections
        .slice(0, 2)
        .map((connectionId) => ({ connectionId, kind: 'jellyfin-user', completedAt: new Date() }))
    );
  await getDb().update(s.providerInstances).set({ settings: { schedule: { enabled: true, intervalMinutes: 30, fullIntervalHours: 48, liveEnabled:false, streamsEnabled:false }, libraryScan: { connectionId: connections[0], externalUserId: null, fullCompletedAt: new Date().toISOString() } } }).where(eq(s.providerInstances.id, instance));
  expect((await scheduleProviderMaintenance({ instanceId: instance })).queued).toBe(0);
  const results = await Promise.all([
    runProviderJob(admin, instance),
    runProviderJob(admin, instance),
  ]);
  expect(results.reduce((n, r) => n + r.queued, 0)).toBe(4);
});
run('independent schedule edits preserve toggles, cadences and scan progress', async () => {
  await updateProviderSchedule(admin, instance, {
    enabled: false, intervalMinutes: 30, fullIntervalHours: 48, liveEnabled:false,
    libraryConnectionId: connections[0], userSyncEnabled: false,
  });
  await Promise.all([
    updateProviderSchedule(admin, instance, { userIntervalMinutes: 17 }),
    updateProviderSchedule(admin, instance, { intervalMinutes: 45 }),
  ]);
  const [saved] = await getDb().select().from(s.providerInstances).where(eq(s.providerInstances.id, instance));
  expect(saved.settings.schedule).toMatchObject({
    enabled: false, intervalMinutes: 45, fullIntervalHours: 48, liveEnabled:false,
    libraryConnectionId: connections[0], userSyncEnabled: false, userIntervalMinutes: 17,
  });
  expect(saved.settings.libraryScan).toMatchObject({ connectionId: connections[0] });
  await expect(updateProviderSchedule(admin, instance, { userIntervalMinutes: 0 })).rejects.toThrow();
  await expect(updateProviderSchedule(admin, instance, { libraryConnectionId: connections[2] })).rejects.toThrow('connected account');
  await expect(updateProviderSchedule(admin, instance, {})).rejects.toThrow('setting');
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
  const [mapping]=await getDb().insert(s.providerItems).values({instanceId:instance,mediaId:movie.id,externalId:marker,kind:'movie'}).returning();
  await getDb().insert(s.availability).values({userId:member,connectionId:connections[1],providerItemId:mapping.id,mediaId:movie.id});
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
