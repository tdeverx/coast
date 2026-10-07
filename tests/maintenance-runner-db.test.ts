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
  promoteAction,
} from '../src/lib/server/queue';
import {jobCheckpoint, saveJobCheckpoint} from '../src/lib/server/queue/execution';
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
    purpose: ['jellyfin.library','jellyfin.sync','seerr.sync','trakt.import'].includes(kind) ? 'scheduled' : kind.endsWith('.live') ? 'live' : 'interactive',
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
  'parallel claims serialize a service scan while unrelated services and account edits can progress',
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
    ).toEqual([user, request].sort());
    expect(await claimNextAction()).toBeNull();
    await getSql()`UPDATE outbox_actions SET state='succeeded' WHERE id=${user}`;
    expect((await claimNextAction())?.id).toBe(edit);
    expect((await claimNextAction())?.id).toBe(library);
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
run('Queue explains a failed account edit that blocks a later import',async()=>{
  const actor={id:users[0],username:'runner',role:'admin' as const,email:null,settings:{}};
  const edit=await queue(1,'jellyfin.user-state');
  await getSql()`update outbox_actions set state='failed' where id=${edit}`;
  const importId=await queue(1,'jellyfin.sync');
  expect(await claimNextAction()).toBeNull();
  expect((await listActions(actor)).find(row=>row.id===importId)?.waitingReason).toBe('account-order');
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
run('Collection cleanup and reviews preserve account ordering without globally blocking other accounts',async()=>{
 const db=getSql(),other=crypto.randomUUID();
 await db`insert into provider_connections(id,user_id,instance_id,external_user_id,credentials) values(${other},${users[1]},${instances[2]},'review-fixture','fixture')`;
 try{
  const cleanup=await queue(3,'trakt.collection-cleanup');
  const first=await enqueueAction({userId:users[1],connectionId:other,kind:'trakt.collection-review',payload:{workId:crypto.randomUUID()}});
  const second=await enqueueAction({userId:users[1],connectionId:other,kind:'trakt.collection-review',payload:{workId:crypto.randomUUID()}});
  expect(first).not.toBe(second);expect((await claimNextAction())?.id).toBe(cleanup);expect(await claimNextAction()).toBeNull();
  await db`update outbox_actions set state='succeeded' where id=${cleanup}`;expect((await claimNextAction())?.id).toBe(first);expect(await claimNextAction()).toBeNull();
  await db`update outbox_actions set state='succeeded' where id=${first}`;expect((await claimNextAction())?.id).toBe(second);
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
    expect((await runProviderJob(users[0], instances[0], 'users')).queued).toBe(2);
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
run('concurrent account requests retain one Jellyfin sync per account without collapsing different users', async()=>{
 const ids=await Promise.all(Array.from({length:12},(_,i)=>queue(i%2,'jellyfin.sync')));
 expect(new Set(ids).size).toBe(2);
 const actions=await getSql()`select id,connection_id from outbox_actions where kind='jellyfin.sync' and connection_id in (${connections[0]},${connections[1]}) and state in ('pending','running')`;
 expect(actions).toHaveLength(2);
 expect(new Set(actions.map((row: {connection_id:string})=>row.connection_id)).size).toBe(2);
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
run('the urgent worker can observe live state between import requests without reordering account writes',async()=>{
 const library=await queue(0,'jellyfin.library');expect((await claimNextAction())?.id).toBe(library);
 const live=await queue(0,'jellyfin.live');const edit=await queue(0,'jellyfin.user-state');
 expect((await claimNextAction(true))?.id).toBe(live);expect(await claimNextAction(true)).toBeNull();
 await getSql()`update outbox_actions set state='succeeded' where id=${library}`;
 expect((await claimNextAction(true))?.id).toBe(edit);
});
run('initial import priority remains completed after old job history is pruned',async()=>{
 registerActionHandler('jellyfin.sync',async()=>{});
 const initial=await queue(0,'jellyfin.sync');await runQueueOnce();
 await getSql()`delete from outbox_actions where id=${initial}`;
 const next=await queue(0,'jellyfin.sync');const claimed=await claimNextAction();
 expect(claimed?.id).toBe(next);expect(claimed?.priority).toBe(3);
});

run('recommendation cards target one job, deduplicate runs, expose timing and respect pause',async()=>{
 const db=getSql(),instance=crypto.randomUUID();
 await db`insert into provider_instances(id,provider,name,base_url,credentials,settings) values(${instance},'tmdb','Recommendations fixture','https://api.themoviedb.org','fixture',${{schedule:{enabled:true,intervalMinutes:10080,fullIntervalHours:24,recommendationsEnabled:true,recommendationsIntervalMinutes:60}}}::jsonb)`;
 await runProviderJob(users[0],instance,'metadata','tmdb.recommendations');
 await runProviderJob(users[0],instance,'metadata','tmdb.recommendations');
 const rows=await db<{kind:string}[]>`select kind,payload from outbox_actions where payload->>'instanceId'=${instance}`;
 expect(rows.map(row=>row.kind)).toEqual(['tmdb.recommendations']);
 const claimed=await claimNextAction();expect(claimed?.instanceId).toBe(instance);expect(claimed?.priority).toBe(1);
 const timings=await jobTimings();expect(timings.some(row=>row.instanceId===instance&&row.kind==='tmdb.recommendations')).toBe(true);
 await updateProviderSchedule(users[0],instance,{recommendationsEnabled:false});
 await db`delete from outbox_actions where payload->>'instanceId'=${instance}`;
 await scheduleProviderMaintenance({instanceId:instance,task:'metadata',kind:'tmdb.recommendations'});
 expect((await db`select id from outbox_actions where payload->>'instanceId'=${instance}`).length).toBe(0);
 expect((await jobTimings()).find(row=>row.instanceId===instance&&row.kind==='tmdb.recommendations')?.nextAt).toBeNull();
});

run('priority promotion reuses work and preserves retry and service cooldowns',async()=>{
  const id=await queue(2,'seerr.sync');
  await getSql()`update outbox_actions set next_attempt_at=now()+interval '20 minutes' where id=${id}`;
  await getSql()`update provider_instances set settings=settings||jsonb_build_object('jobsRetryAt',(now()+interval '1 hour')::text) where id=${instances[1]}`;
  const actor={id:users[0],username:'runner',role:'admin' as const,email:null,settings:{}};
  expect(await promoteAction(actor,id)).toMatchObject({id,state:'pending',purpose:'manual'});
  expect(await enqueueAction({userId:users[0],connectionId:connections[2],kind:'seerr.sync',purpose:'manual',payload:{}})).toBe(id);
  const [row]=await getSql()`select next_attempt_at,payload from outbox_actions where id=${id}`;
  expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now()+19*60000);
  expect(row.payload._jobPurpose).toBe('manual');
  expect((await listActions(actor)).find(row=>row.id===id)?.waitingReason).toBe('service-cooldown');
  expect(await claimNextAction()).toBeNull();
});
run('manual reads overtake lower-priority account maintenance and Queue displays the same order',async()=>{
  const older=await enqueueAction({userId:users[0],connectionId:connections[2],kind:'catalogue.user-scan',purpose:'scheduled',payload:{}});
  const requested=await enqueueAction({userId:users[0],connectionId:connections[2],kind:'seerr.sync',purpose:'manual',payload:{}});
  const actor={id:users[0],username:'runner',role:'admin' as const,email:null,settings:{}};
  const rows=await listActions(actor);
  expect(rows.filter(row=>row.state==='pending').map(row=>row.id)).toEqual([requested,older]);
  expect((await claimNextAction())?.id).toBe(requested);
  expect(await claimNextAction()).toBeNull();
  await getSql()`update outbox_actions set state='succeeded' where id=${requested}`;
  expect((await claimNextAction())?.id).toBe(older);
});
run('Queue places runnable work before urgent jobs held by service cooldown',async()=>{
  const cooling=await queue(1,'jellyfin.sync');
  await getSql()`update provider_instances set settings=settings||jsonb_build_object('jobsRetryAt',(now()+interval '1 hour')::text) where id=${instances[0]}`;
  const ready=await queue(2,'seerr.sync');
  const actor={id:users[0],username:'runner',role:'admin' as const,email:null,settings:{}};
  const pending=(await listActions(actor)).filter(row=>row.state==='pending');
  expect(pending.map(row=>row.id)).toEqual([ready,cooling]);
  expect(pending[1].waitingReason).toBe('service-cooldown');
  expect((await claimNextAction())?.id).toBe(ready);
  expect(await claimNextAction()).toBeNull();
});
run('a running account edit blocks an older import and Queue places unrelated ready work first',async()=>{
  const held=await queue(1,'jellyfin.sync');
  const edit=await queue(1,'jellyfin.user-state');
  await getSql()`update outbox_actions set state='running' where id=${edit}`;
  const ready=await queue(2,'seerr.sync');
  const actor={id:users[0],username:'runner',role:'admin' as const,email:null,settings:{}};
  const pending=(await listActions(actor)).filter(row=>row.state==='pending');
  expect(pending.map(row=>row.id)).toEqual([ready,held]);
  expect(pending[1].waitingReason).toBe('account-order');
  expect((await claimNextAction())?.id).toBe(ready);
  expect(await claimNextAction()).toBeNull();
  await getSql()`update outbox_actions set state='succeeded' where id=${edit}`;
  expect((await claimNextAction())?.id).toBe(held);
});
run('committed chunks yield without failure attempts and continue the same durable action',async()=>{
  registerActionHandler('seerr.sync',async action=>{
    const saved=action.payload._checkpoint as {next:number}|undefined;
    for(let next=saved?.next??0;next<7;next++){
      await saveJobCheckpoint({next:next+1});
      await jobCheckpoint();
    }
    return {checked:7};
  });
  const id=await queue(2,'seerr.sync');
  expect(await runQueueOnce()).toBe(true);
  const [paused]=await getSql()`select state,attempts,payload,last_error from outbox_actions where id=${id}`;
  expect(paused).toMatchObject({state:'pending',attempts:0,last_error:null});
  expect(paused.payload._checkpoint).toEqual({next:5});
  expect(paused.payload._jobFailure).toBeUndefined();
  expect(await runQueueOnce()).toBe(true);
  const [complete]=await getSql()`select state,attempts,payload from outbox_actions where id=${id}`;
  expect(complete).toMatchObject({state:'succeeded',attempts:1});
  expect(complete.payload._jobOutcome).toEqual({checked:7});
});
