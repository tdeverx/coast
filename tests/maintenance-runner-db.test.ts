import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { jobTimings } from '../src/lib/providers/job-timing.server';
import { getSql } from '../src/lib/server/db';
import {
  enqueueAction,
  claimNextAction,
  registerActionHandler,
  runQueueOnce,
  PermanentActionError,
  listActions,
} from '../src/lib/server/queue';
import { ProviderHttpError } from '../src/lib/server/security/provider-fetch';
import {
  scheduleProviderMaintenance,
  runProviderJob,
  updateProviderSchedule,
} from '../src/lib/providers/maintenance.server';
import { getConfig, type CoastConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const users = Array.from({ length: 3 }, () => crypto.randomUUID());
const instances = Array.from({ length: 3 }, () => crypto.randomUUID());
const connections = Array.from({ length: 4 }, () => crypto.randomUUID());
let previous: CoastConfig;
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  previous = await getConfig();
  for (const [index, id] of users.entries())
    await getSql()`INSERT INTO users (id, username, role) VALUES (${id}, ${`runner-${id}`}, ${index ? 'user' : 'admin'})`;
  for (const [index, id] of instances.entries())
    await getSql()`INSERT INTO provider_instances (id, provider, name, base_url, settings) VALUES (${id}, ${['jellyfin', 'seerr', 'trakt'][index]}, 'Runner fixture', 'https://fixture.invalid', ${{ schedule: { enabled: true, intervalMinutes: 10, fullIntervalHours: 24 } }}::jsonb)`;
  for (const [index, id] of connections.entries())
    await getSql()`INSERT INTO provider_connections (id, user_id, instance_id, status, external_user_id, credentials, settings) VALUES (${id}, ${users[index === 1 ? 1 : 0]}, ${instances[index < 2 ? 0 : index - 1]}, 'connected', ${`external-${index}`}, 'fixture', ${{ sync: { history: true, lists: true } }}::jsonb)`;
  await updateConfig(
    { id: users[0], username: 'runner', role: 'admin', email: null, settings: {} },
    { ...previous, enableTrakt: true, enableRequests: true }
  );
});
beforeEach(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  for (const id of users) await getSql()`DELETE FROM outbox_actions WHERE user_id = ${id}`;
  for (const id of instances)
    await getSql()`UPDATE provider_instances SET settings = settings - 'jobsRetryAt' WHERE id = ${id}`;
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await updateConfig(
    { id: users[0], username: 'runner', role: 'admin', email: null, settings: {} },
    previous
  );
  for (const id of instances) await getSql()`DELETE FROM provider_instances WHERE id = ${id}`;
  for (const id of users) await getSql()`DELETE FROM users WHERE id = ${id}`;
});
const queue = (connection: number, kind: string) =>
  enqueueAction({
    userId: users[connection === 1 ? 1 : 0],
    connectionId: connections[connection],
    kind,
    payload: {},
  });
run('repeated maintenance requests preserve one durable job in every active state', async () => {
  const ids = await Promise.all(Array.from({ length: 8 }, () => queue(0, 'jellyfin.sync')));
  expect(new Set(ids).size).toBe(1);
  for (const state of ['running', 'failed']) {
    await getSql()`UPDATE outbox_actions SET state = ${state} WHERE id = ${ids[0]}`;
    expect(await queue(0, 'jellyfin.sync')).toBe(ids[0]);
  }
});
run(
  'parallel claims serialize provider jobs globally while user edits proceed',
  async () => {
    const library = await queue(0, 'jellyfin.library');
    const user = await queue(1, 'jellyfin.sync');
    const request = await queue(2, 'seerr.sync');
    const edit = await queue(1, 'jellyfin.user-state');
    const claims = await Promise.all(Array.from({ length: 4 }, () => claimNextAction()));
    expect(
      claims
        .filter(Boolean)
        .map((job) => job!.id)
        .sort()
    ).toEqual([library, edit].sort());
    await getSql()`UPDATE outbox_actions SET state = 'succeeded' WHERE id IN (${library}, ${edit})`;
    expect((await claimNextAction())?.id).toBe(user);
    expect(await claimNextAction()).toBeNull();
    await getSql()`UPDATE outbox_actions SET state='succeeded' WHERE id=${user}`;
    expect((await claimNextAction())?.id).toBe(request);
  }
);
run('failed and backed-off maintenance does not block other users or later edits', async () => {
  const failed = await queue(0, 'jellyfin.library');
  await getSql()`UPDATE outbox_actions SET state = 'failed' WHERE id = ${failed}`;
  const user = await queue(1, 'jellyfin.sync');
  expect((await claimNextAction())?.id).toBe(user);
  await getSql()`UPDATE outbox_actions SET state = 'pending', next_attempt_at = NOW() + INTERVAL '1 hour' WHERE id = ${user}`;
  const edit = await queue(1, 'jellyfin.user-state');
  expect((await claimNextAction())?.id).toBe(edit);
});
run('shared rate-limit cooldown protects all queued accounts on the affected service', async () => {
  registerActionHandler('jellyfin.library', async () => {
    throw new ProviderHttpError(429, 60);
  });
  const limited = await queue(0, 'jellyfin.library');
  await runQueueOnce();
  const other = await queue(1, 'jellyfin.sync');
  const unrelated = await queue(2, 'seerr.sync');
  expect((await claimNextAction())?.id).toBe(unrelated);
  expect(await claimNextAction()).toBeNull();
  const [state] =
    await getSql()`SELECT state, next_attempt_at FROM outbox_actions WHERE id = ${limited}`;
  expect(state.state).toBe('pending');
  expect(new Date(state.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 50000);
  await getSql()`UPDATE provider_instances SET settings = settings - 'jobsRetryAt' WHERE id = ${instances[0]}`;
  await getSql()`UPDATE outbox_actions SET state='succeeded' WHERE id=${unrelated}`;
  expect((await claimNextAction())?.id).toBe(other);
});
run('Collection cleanup and entry reviews share the existing service traversal lock without deduplicating separate reviews',async()=>{
 const db=getSql(),other=crypto.randomUUID();
 await db`insert into provider_connections(id,user_id,instance_id,external_user_id,credentials) values(${other},${users[1]},${instances[2]},'review-fixture','fixture')`;
 try{
  const cleanup=await queue(3,'trakt.collection-cleanup');
  const first=await enqueueAction({userId:users[1],connectionId:other,kind:'trakt.collection-review',payload:{workId:crypto.randomUUID()}});
  const second=await enqueueAction({userId:users[1],connectionId:other,kind:'trakt.collection-review',payload:{workId:crypto.randomUUID()}});
  expect(first).not.toBe(second);expect((await claimNextAction())?.id).toBe(cleanup);expect(await claimNextAction()).toBeNull();
  await db`update outbox_actions set state='succeeded' where id=${cleanup}`;expect((await claimNextAction())?.id).toBe(first);
 }finally{await db`delete from provider_connections where id=${other}`;}
});
run(
  'session lock prevents concurrent scan execution when a running lease becomes stale',
  async () => {
    let finish!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let executions = 0;
    registerActionHandler('jellyfin.library', async () => {
      executions++;
      started();
      await gate;
    });
    const id = await queue(0, 'jellyfin.library');
    const first = runQueueOnce();
    await entered;
    await getSql()`UPDATE outbox_actions SET locked_at = NOW() - INTERVAL '6 minutes' WHERE id = ${id}`;
    try {
      await runQueueOnce();
      expect(executions).toBe(1);
    } finally {
      finish();
      await first;
    }
  }
);
run('permanent provider failures require attention without endless retry', async () => {
  registerActionHandler('seerr.sync', async () => {
    throw new PermanentActionError('fixture');
  });
  const id = await queue(2, 'seerr.sync');
  await runQueueOnce();
  const rows = await listActions({
    id: users[0],
    username: 'runner',
    email: null,
    role: 'admin',
    settings: {},
  });
  expect(rows.find((job) => job.id === id)).toMatchObject({
    state: 'failed',
    attempts: 1,
    instanceId: instances[1],
    provider: 'seerr',
  });
});
run(
  'Trakt separates tracking, lists and live reads; import opt-outs do not disable live presence',
  async () => {
    const result = await scheduleProviderMaintenance({ instanceId: instances[2] });
    expect(result.queued).toBe(3);
    const jobs =
      await getSql()`SELECT kind FROM outbox_actions WHERE connection_id = ${connections[3]}`;
    expect(jobs.map((job: { kind: string }) => job.kind).sort()).toEqual([
      'trakt.import',
      'trakt.lists-import',
      'trakt.live',
    ]);
    await getSql()`DELETE FROM outbox_actions WHERE connection_id = ${connections[3]}`;
    await getSql()`UPDATE provider_connections SET settings = '{"sync":{"scrobble":true}}'::jsonb WHERE id = ${connections[3]}`;
    expect((await runProviderJob(users[0], instances[2])).queued).toBe(1);
  }
);
run(
  'manual Jellyfin controls have distinct scopes and reject another service’s source account',
  async () => {
    await expect(
      updateProviderSchedule(users[0], instances[0], {
        enabled: true,
        intervalMinutes: 10,
        fullIntervalHours: 24,
        libraryConnectionId: connections[2],
      })
    ).rejects.toThrow('Choose a connected account');
    expect((await runProviderJob(users[0], instances[0], 'users')).queued).toBe(1);
    let jobs =
      await getSql()`SELECT kind FROM outbox_actions WHERE connection_id IN (${connections[0]}, ${connections[1]})`;
    expect(jobs.every((job: { kind: string }) => job.kind === 'jellyfin.sync')).toBe(true);
    expect((await runProviderJob(users[0], instances[0], 'library')).queued).toBe(1);
    jobs =
      await getSql()`SELECT kind FROM outbox_actions WHERE kind = 'jellyfin.library' AND connection_id IN (${connections[0]}, ${connections[1]})`;
    expect(jobs).toHaveLength(1);
    await expect(runProviderJob(users[0], instances[1], 'library')).rejects.toThrow('unavailable');
  }
);
run('concurrent account requests cannot queue the same service task twice', async()=>{
 const ids=await Promise.all(Array.from({length:12},(_,i)=>queue(i%2,'jellyfin.sync')));
 expect(new Set(ids).size).toBe(1);
 const actions=await getSql()`select id from outbox_actions where kind='jellyfin.sync' and connection_id in (${connections[0]},${connections[1]}) and state in ('pending','running')`;
 expect(actions).toHaveLength(1);
});

run('Run now targets the selected card rather than its shared schedule siblings', async () => {
  await getSql()`update provider_connections set settings = ${{ sync: {history: true, lists: true}, collectionProjection: {enabled:true} }}::jsonb where id=${connections[3]}`;
  await runProviderJob(users[0], instances[2], 'tracking', 'trakt.import');
  const rows = await getSql()`select kind from outbox_actions where connection_id=${connections[3]}`;
  expect(rows.map((row: { kind: string }) => row.kind)).toEqual(['trakt.import']);
  await expect(runProviderJob(users[0], instances[2], 'tracking', 'jellyfin.sync')).rejects.toThrow('unavailable');
});

run('Jobs timing uses every eligible account rather than one recent successful scan', async () => {
  await getSql()`insert into sync_checkpoints(connection_id,kind,completed_at) values(${connections[0]},'jellyfin-user',now()) on conflict(connection_id,kind) do update set completed_at=now()`;
  const timing = (await jobTimings()).find(entry => entry.instanceId === instances[0] && entry.kind === 'jellyfin.sync');
  expect(timing?.eligible).toBe(2);
  expect(timing?.fresh).toBe(1);
  expect(new Date(timing!.nextAt!).getTime()).toBeLessThanOrEqual(Date.now()+1000);
});
run('successful delivery retains its measured outcome for run history', async () => {
  registerActionHandler('fixture.outcome', async () => ({added:84}));
  const id=await queue(0,'fixture.outcome');
  await runQueueOnce();
  const [row]=await getSql()`select payload->'_jobOutcome' as outcome from outbox_actions where id=${id}`;
  expect(row.outcome).toEqual({added:84});
});

run('stored failure codes drive remedies and disappear after successful retry',async()=>{
 const id=await queue(0,'fixture.failure');
 registerActionHandler('fixture.failure',async()=>{throw new ProviderHttpError(403);});
 await runQueueOnce();
 const [failed]=await getSql()`select state,payload from outbox_actions where id=${id}`;
 expect(failed.state).toBe('failed');expect(failed.payload._jobFailure).toEqual({code:'provider.permission',remedy:'permissions',retryable:false});
 registerActionHandler('fixture.failure',async()=>{});
 await getSql()`update outbox_actions set state='pending',next_attempt_at=now() where id=${id}`;
 await runQueueOnce();
 const [completed]=await getSql()`select state,payload from outbox_actions where id=${id}`;
 expect(completed.state).toBe('succeeded');expect(completed.payload._jobFailure).toBeUndefined();
});

run('a cancelled or replaced worker cannot publish a service cooldown',async()=>{
  registerActionHandler('jellyfin.library',async(action)=>{
    await getSql()`update outbox_actions set state='cancelled' where id=${action.id}`;
    throw new ProviderHttpError(429,60);
  });
  await queue(0,'jellyfin.library');await runQueueOnce();
  const [service]=await getSql()`select settings->>'jobsRetryAt' as retry from provider_instances where id=${instances[0]}`;
  expect(service.retry).toBeNull();
  const unrelated=await queue(2,'seerr.sync');expect((await claimNextAction())?.id).toBe(unrelated);
});
