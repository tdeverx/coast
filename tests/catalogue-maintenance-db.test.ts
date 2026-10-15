import { beforeAll, afterAll, test, expect } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {
  scheduleProviderMaintenance,
  runProviderJob,
  updateProviderSchedule,
} from '../src/lib/providers/maintenance.server';
import { persistMissingTmdb } from '../src/lib/catalogue/maintenance.server';
import {
  claimNextAction,
  listActions,
  retryAction,
} from '../src/lib/server/queue';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const admin = crypto.randomUUID(),
  member = crypto.randomUUID(),
  disabled = crypto.randomUUID(),
  instance = crypto.randomUUID(),
  jellyfin = crypto.randomUUID();
const mediaIds = [crypto.randomUUID(), crypto.randomUUID()];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .insert(s.users)
    .values([
      { id: admin, username: 'catalogue-' + admin, role: 'admin' },
      { id: member, username: 'catalogue-' + member },
      { id: disabled, username: 'catalogue-' + disabled, disabled: true },
    ]);
  await getDb()
    .insert(s.providerInstances)
    .values([
      {
        id: instance,
        provider: 'tmdb',
        name: 'Metadata fixture',
        baseUrl: 'https://fixture.invalid',
        credentials: 'fixture-not-used',
        settings: {
          schedule: {
            enabled: false,
            intervalMinutes: 10080,
            fullIntervalHours: 24,
          },
        },
      },
      {
        id: jellyfin,
        provider: 'jellyfin',
        name: 'User catalogue fixture',
        baseUrl: 'https://fixture.invalid',
        settings: {
          schedule: {
            enabled: false,
            intervalMinutes: 10,
            fullIntervalHours: 24,
          },
        },
      },
    ]);
  await getDb()
    .insert(s.providerConnections)
    .values(
      [member, disabled].map((userId) => ({ userId, instanceId: jellyfin }))
    );
  await getDb()
    .insert(s.media)
    .values(
      mediaIds.map((id) => ({
        id,
        kind: 'movie' as const,
        title: 'Shared catalogue fixture',
      }))
    );
  await getDb()
    .insert(s.externalIds)
    .values(
      mediaIds.map((mediaId, i) => ({
        mediaId,
        provider: 'tmdb',
        externalId: String(1900000000 + i),
        mediaKind: 'movie' as const,
      }))
    );
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb()
    .delete(s.users)
    .where(inArray(s.users.id, [admin, member, disabled]));
  await getDb()
    .delete(s.providerInstances)
    .where(inArray(s.providerInstances.id, [instance, jellyfin]));
  await getDb().delete(s.media).where(inArray(s.media.id, mediaIds));
});
run(
  'selected shared refresh respects pause, manual runs deduplicate, records attach to TMDB in Jobs',
  async () => {
    expect(
      (await scheduleProviderMaintenance({ instanceId: instance, kind: 'tmdb.refresh' })).queued
    ).toBe(0);
    await expect(runProviderJob(member, instance, 'metadata')).rejects.toThrow(
      'Administrator'
    );
    const first = await runProviderJob(admin, instance, 'metadata', 'tmdb.refresh');
    expect(first.queued).toBe(1);
    const second = await runProviderJob(admin, instance, 'metadata', 'tmdb.refresh');
    expect(second.queued).toBe(0);
    const actions = await listActions({
      id: admin,
      username: 'fixture',
      role: 'admin',
    } as Parameters<typeof listActions>[0]);
    expect(actions.filter((a) => a.instanceId === instance).length).toBe(
      first.queued
    );
    await getDb()
      .update(s.providerInstances)
      .set({
        settings: {
          schedule: {
            enabled: false,
            intervalMinutes: 10080,
            fullIntervalHours: 24,
          },
          jobsRetryAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
      .where(eq(s.providerInstances.id, instance));
    expect(await claimNextAction()).toBeNull();
    await getDb()
      .update(s.providerInstances)
      .set({
        settings: {
          schedule: {
            enabled: false,
            intervalMinutes: 10080,
            fullIntervalHours: 24,
          },
        },
      })
      .where(eq(s.providerInstances.id, instance));
    const claimed = await claimNextAction();
    expect(claimed?.instanceId).toBe(instance);
    expect(claimed?.kind).toBe('tmdb.refresh');
    expect(claimed?.payload._jobPurpose).toBe('manual');
    await getDb().update(s.outboxActions).set({payload:{instanceId:instance,_jobPurpose:'scheduled'}}).where(eq(s.outboxActions.id,claimed!.id));
    expect((await runProviderJob(admin,instance,'metadata','tmdb.refresh')).active).toBe(1);
    const [promoted]=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id,claimed!.id));
    expect(promoted.payload._jobPurpose).toBe('manual');
    expect(await claimNextAction()).toBeNull();
    await getDb()
      .update(s.outboxActions)
      .set({ state: 'failed' })
      .where(eq(s.outboxActions.id, claimed!.id));
    expect((await runProviderJob(admin, instance, 'metadata', 'tmdb.refresh')).queued).toBe(0);
    expect(await claimNextAction()).toBeNull();
    await retryAction(
      { id: admin, username: 'fixture', role: 'admin' } as Parameters<
        typeof retryAction
      >[0],
      claimed!.id
    );
    const next = await claimNextAction();
    expect(next?.kind).toBe('tmdb.refresh');
    expect(next?.id).toBe(claimed?.id);
    await getDb()
      .update(s.outboxActions)
      .set({ state: 'succeeded' })
      .where(eq(s.outboxActions.id, next!.id));
  }
);
run(
  'user discovery is independently controllable and excludes disabled users',
  async () => {
    const result = await runProviderJob(admin, jellyfin, 'catalogue');
    expect(result.queued).toBe(1);
    const connections = await getDb()
      .select()
      .from(s.providerConnections)
      .where(eq(s.providerConnections.instanceId, jellyfin));
    const actions = await getDb()
      .select()
      .from(s.outboxActions)
      .where(
        inArray(
          s.outboxActions.connectionId,
          connections.map((c) => c.id)
        )
      );
    expect(actions.map((a) => a.kind)).toEqual(['catalogue.user-scan']);
    expect(actions[0].userId).toBe(member);
    await getDb()
      .delete(s.outboxActions)
      .where(eq(s.outboxActions.userId, member));
    await updateProviderSchedule(admin, jellyfin, {
      enabled: true,
      catalogueEnabled: false,
      libraryEnabled: false,
      userSyncEnabled: false, liveEnabled:false,
    });
    expect(
      (await scheduleProviderMaintenance({ instanceId: jellyfin })).queued
    ).toBe(0);
  }
);
run(
  'existing shared identity skips TMDB fetch and never creates personal relationships',
  async () => {
    expect(await persistMissingTmdb('movie', '1900000000')).toBe(false);
    const state = await getDb()
      .select()
      .from(s.trackingState)
      .where(eq(s.trackingState.mediaId, mediaIds[0]));
    expect(state).toHaveLength(0);
  }
);

run(
  'missing verified references are persisted once without personal state or recommendations',
  async () => {
    const id = String(1950000000 + Math.floor(Math.random() * 10000000));
    expect(
      await persistMissingTmdb('movie', id, { title: 'Remote direct title' })
    ).toBe(true);
    expect(
      await persistMissingTmdb('movie', id, {
        title: 'Duplicate remote title',
      })
    ).toBe(false);
    const [mapping] = await getDb()
      .select()
      .from(s.externalIds)
      .where(eq(s.externalIds.externalId, id));
    const state = await getDb()
      .select()
      .from(s.trackingState)
      .where(eq(s.trackingState.mediaId, mapping.mediaId));
    expect(state).toHaveLength(0);
    const related = await getDb()
      .select()
      .from(s.mediaRelationships)
      .where(eq(s.mediaRelationships.parentId, mapping.mediaId));
    expect(related).toHaveLength(0);
    await getDb().delete(s.media).where(eq(s.media.id, mapping.mediaId));
  }
);
run(
  'one bounded batch defers individual missing records and skips fresh records',
  async () => {
    const { refreshSharedMetadata } =
      await import('../src/lib/catalogue/maintenance.server');
    const { ingestMetadata } = await import('../src/lib/catalogue/service.server');
    const { ProviderHttpError } =
      await import('../src/lib/server/security/provider-fetch');
    let active = 0,
      peak = 0,
      calls = 0;
    await refreshSharedMetadata(
      {
        id: crypto.randomUUID(),
        userId: admin,
        connectionId: null,
        kind: 'tmdb.refresh',
        payload: { instanceId: instance },
        attempts: 1,
        correlationId: crypto.randomUUID(),
      },
      async (id) => {
        active++;
        peak = Math.max(peak, active);
        calls++;
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (id === mediaIds[0]) throw new ProviderHttpError(404);
          const [identity] = await getDb()
            .select()
            .from(s.externalIds)
            .where(eq(s.externalIds.mediaId, id));
          return await ingestMetadata(
            {
              provider: 'tmdb',
              externalId: identity.externalId,
              kind: 'movie',
              title: 'Refreshed fixture',
              tasteFeatures:{},
            },
            { mediaId: id, complete: true }
          );
        } finally {
          active--;
        }
      }
    );
    expect(calls).toBe(2);
    expect(peak).toBe(1);
    const [saved] = await getDb()
      .select()
      .from(s.providerInstances)
      .where(eq(s.providerInstances.id, instance));
    expect(saved.settings.metadataScan).toMatchObject({
      processed: 2,
      failed: 1,
      total: 2,
    });
    await updateProviderSchedule(admin, instance, { enabled: true });
    expect(
      (await scheduleProviderMaintenance({ instanceId: instance, kind: 'tmdb.refresh' })).queued
    ).toBe(0);
  }
);
run('forced metadata refresh retains its finite batch across cooperative yields',async()=>{
  const {refreshSharedMetadata}=await import('../src/lib/catalogue/maintenance.server');
  const {jobExecution,JobYield}=await import('../src/lib/server/queue/execution');
  const {ProviderHttpError}=await import('../src/lib/server/security/provider-fetch');
  const id=crypto.randomUUID(),calls:string[]=[];
  const action={id,userId:admin,connectionId:null,kind:'tmdb.refresh',payload:{instanceId:instance,force:true},attempts:1,correlationId:crypto.randomUUID()};
  await getDb().insert(s.outboxActions).values({...action,state:'running'});
  const refresh=async(mediaId:string)=>{calls.push(mediaId);throw new ProviderHttpError(404);};
  try{
    await expect(jobExecution.run({id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:4},()=>refreshSharedMetadata(action,refresh))).rejects.toBeInstanceOf(JobYield);
    const [saved]=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id,id));
    expect(saved.payload._checkpoint).toMatchObject({task:'tmdb-refresh',next:1,failed:1});
    expect(await jobExecution.run({id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},()=>refreshSharedMetadata(action,refresh))).toEqual({refreshed:0,deferred:2});
    expect(calls).toHaveLength(2);expect(new Set(calls).size).toBe(2);
  }finally{await getDb().delete(s.outboxActions).where(eq(s.outboxActions.id,id));}
});
