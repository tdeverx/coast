import { afterAll, beforeAll, expect, test } from 'bun:test';
import { getSql } from '../src/lib/server/db';
import { getConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
import { jobTimings } from '../src/lib/providers/job-timing.server';
import { scheduleProviderMaintenance, runProviderJob } from '../src/lib/providers/maintenance.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const admin = crypto.randomUUID(), member = crypto.randomUUID(), instance = crypto.randomUUID();
const accounts = [crypto.randomUUID(), crypto.randomUUID()];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getSql()`insert into users(id,username,role) values(${admin},${`timing-admin-${admin}`},'admin'),(${member},${`timing-member-${member}`},'user')`;
  await getSql()`insert into provider_instances(id,provider,name,base_url,settings) values(${instance},'jellyfin','Timing fixture','https://fixture.invalid',${{
    schedule: { enabled: true, intervalMinutes: 10, fullIntervalHours: 24, liveEnabled: false, streamsEnabled: false, updatesEnabled:false, catalogueEnabled: false },
    libraryScan: { connectionId: accounts[0], externalUserId: 'admin', fullCompletedAt: new Date().toISOString(), recentCompletedAt: new Date().toISOString() },
  }}::jsonb)`;
  for (const [index, account] of accounts.entries()) await getSql()`insert into provider_connections(id,user_id,instance_id,status,external_user_id) values(${account},${index ? member : admin},${instance},'connected',${index ? 'member' : 'admin'})`;
  await getSql()`insert into sync_checkpoints(connection_id,kind,completed_at) values(${accounts[0]},'jellyfin-user',now())`;
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getSql()`delete from provider_instances where id=${instance}`;
  await getSql()`delete from users where id in (${admin},${member})`;
});
run('Jobs due evidence and timer choose the same account, then show its pending work', async () => {
  const timings = await jobTimings();
  const timing = timings.find(entry => entry.instanceId === instance && entry.kind === 'jellyfin.sync')!;
  expect(timing.eligible).toBe(2); expect(timing.fresh).toBe(1);
  expect(new Date(timing.nextAt!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  const bootstrap = timings.find(entry => entry.instanceId === instance && entry.kind === 'jellyfin.bootstrap');
  expect(bootstrap?.nextAt).toBeNull();
  expect((await scheduleProviderMaintenance({ instanceId: instance })).queued).toBe(1);
  const jobs = await getSql()`select connection_id,payload from outbox_actions where connection_id in (${accounts[0]},${accounts[1]})`;
  expect(jobs).toHaveLength(1); expect(jobs[0].connection_id).toBe(accounts[1]);
  expect(jobs[0].payload._jobPurpose).toBe('scheduled');
  expect(new Date((await jobTimings()).find(entry => entry.instanceId === instance && entry.kind === 'jellyfin.sync')!.nextAt!).getTime()).toBeGreaterThan(Date.now());
});
run('manual run promotes a running account and queues the other account separately', async () => {
  await getSql()`update outbox_actions set state='running' where connection_id=${accounts[1]} and kind='jellyfin.sync'`;
  const result = await runProviderJob(admin, instance, 'users', 'jellyfin.sync');
  expect(result.queued).toBe(1); expect(result.active).toBe(1);
  const jobs = await getSql()`select connection_id,state,payload from outbox_actions where connection_id in (${accounts[0]},${accounts[1]}) and kind='jellyfin.sync'`;
  expect(jobs).toHaveLength(2);
  for (const job of jobs) { expect(job.payload._jobPurpose).toBe('manual'); expect(job.payload._manual).toBe(true); }
  expect((await runProviderJob(admin, instance, 'users', 'jellyfin.sync')).queued).toBe(0);
});
run('manual promotion preserves stronger intent and obsolete generations cannot suppress current account work', async () => {
  await getSql()`update outbox_actions set payload=payload||'{"_jobPurpose":"bootstrap"}'::jsonb where connection_id=${accounts[0]} and kind='jellyfin.sync'`;
  await getSql()`update outbox_actions set payload=payload||'{"_jobPurpose":"scheduled"}'::jsonb where connection_id=${accounts[1]} and kind='jellyfin.sync'`;
  await getSql()`update provider_connections set account_generation=${crypto.randomUUID()} where id=${accounts[1]}`;
  const result = await runProviderJob(admin, instance, 'users', 'jellyfin.sync');
  expect(result.queued).toBe(1); expect(result.active).toBe(1);
  const jobs = await getSql()<{connection_id:string;payload:Record<string,unknown>;current:boolean}[]>`select a.connection_id,a.payload,a.account_generation=c.account_generation as current from outbox_actions a join provider_connections c on c.id=a.connection_id where c.id in (${accounts[0]},${accounts[1]}) and a.kind='jellyfin.sync'`;
  expect(jobs).toHaveLength(3);
  expect(jobs.find(job => job.connection_id === accounts[0])?.payload._jobPurpose).toBe('bootstrap');
  expect(jobs.find(job => job.connection_id === accounts[1] && !job.current)?.payload._jobPurpose).toBe('scheduled');
  expect(jobs.find(job => job.connection_id === accounts[1] && job.current)?.payload._jobPurpose).toBe('manual');
});

run('recommendation timing uses account cadence while manual runs retain every requested account', async () => {
  const previous = await getConfig(), integration = crypto.randomUUID();
  const connections = [crypto.randomUUID(), crypto.randomUUID()];
  const actor = { id: admin, username: 'timing-admin', role: 'admin' as const, email: null, settings: {} };
  try {
    await updateConfig(actor, { ...previous, enableTrakt: true });
    await getSql()`insert into provider_instances(id,provider,name,base_url,credentials,settings) values(${integration},'trakt','Timing recommendation fixture','https://fixture.invalid','fixture',${{ schedule: { enabled: true, intervalMinutes: 10, fullIntervalHours: 24, liveEnabled: false, catalogueEnabled: false, recommendationsIntervalMinutes: 60 } }}::jsonb)`;
    for (const [index, connection] of connections.entries()) await getSql()`insert into provider_connections(id,user_id,instance_id,status,credentials) values(${connection},${index ? member : admin},${integration},'connected','fixture')`;
    await getSql()`insert into outbox_actions(user_id,connection_id,account_generation,kind,state,payload) select ${admin},id,account_generation,'trakt.recommendations','succeeded',${{instanceId: integration}}::jsonb from provider_connections where id=${connections[0]}`;
    const timing = (await jobTimings()).find(entry => entry.instanceId === integration && entry.kind === 'trakt.recommendations')!;
    expect(timing.eligible).toBe(2); expect(timing.fresh).toBe(1); expect(new Date(timing.nextAt!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await scheduleProviderMaintenance({ instanceId: integration, kind: 'trakt.recommendations' })).queued).toBe(1);
    const [scheduled] = await getSql()`select connection_id,payload from outbox_actions where kind='trakt.recommendations' and state='pending' and payload->>'instanceId'=${integration}`;
    expect(scheduled.connection_id).toBe(connections[1]); expect(scheduled.payload._jobPurpose).toBe('scheduled');
    const manual = await runProviderJob(admin, integration, 'tracking', 'trakt.recommendations');
    expect(manual.queued).toBe(1); expect(manual.active).toBe(1);
    const jobs = await getSql()<{payload:Record<string,unknown>}[]>`select payload from outbox_actions where kind='trakt.recommendations' and state='pending' and payload->>'instanceId'=${integration}`;
    expect(jobs).toHaveLength(2); expect(jobs.every(job => job.payload._jobPurpose === 'manual')).toBe(true);
  } finally {
    await getSql()`delete from provider_instances where id=${integration}`;
    await updateConfig(actor, previous);
  }
});

run('manual library run upgrades pending recent work and retains a full followup while recent work is running', async () => {
  const [job] = await getSql()`insert into outbox_actions(user_id,connection_id,account_generation,kind,payload)
    select ${admin},id,account_generation,'jellyfin.library','{"full":false,"_jobPurpose":"scheduled"}'::jsonb from provider_connections where id=${accounts[0]} returning id`;
  expect((await runProviderJob(admin, instance, 'library', 'jellyfin.library')).queued).toBe(0);
  const [pending] = await getSql()`select payload from outbox_actions where id=${job.id}`;
  expect(pending.payload.full).toBe(true); expect(pending.payload._jobPurpose).toBe('manual');
  await getSql()`update outbox_actions set state='running',payload='{"full":false,"_jobPurpose":"scheduled"}'::jsonb where id=${job.id}`;
  const requested = await runProviderJob(admin, instance, 'library', 'jellyfin.library');
  expect(requested.queued).toBe(0); expect(requested.active).toBe(1);
  const [running] = await getSql()`select payload from outbox_actions where id=${job.id}`;
  expect(running.payload.full).toBe(false); expect(running.payload._followupFull).toBe(true); expect(running.payload._jobPurpose).toBe('manual');
  expect((await getSql()`select id from outbox_actions where kind='jellyfin.library' and connection_id in (${accounts[0]},${accounts[1]})`)).toHaveLength(1);
});

run('last run comes from retained task records beyond the display limit and rejects an obsolete generation',async()=>{
 const db=getSql(),id=crypto.randomUUID();
 await db`insert into outbox_actions(id,user_id,connection_id,kind,payload,state,updated_at) values(${id},${admin},${accounts[0]},'jellyfin.live',${{_jobOutcome:{checked:12}}}::jsonb,'succeeded',now()-interval '400 days')`;
 await db`insert into outbox_actions(user_id,kind,payload,state) select ${admin},'unrelated.fixture','{}'::jsonb,'succeeded' from generate_series(1,60)`;
 const read=()=>jobTimings().then(rows=>rows.find(row=>row.instanceId===instance&&row.kind==='jellyfin.live'));
 expect((await read())?.lastRun).toMatchObject({id,state:'succeeded',outcome:{checked:12}});
 await db`update provider_connections set external_user_id='replacement' where id=${accounts[0]}`;
 expect((await read())?.lastRun).toBeNull();
});

run('users completed counts latest eligible account runs, independently of freshness',async()=>{
 const db=getSql(),service=crypto.randomUUID(),linked=[crypto.randomUUID(),crypto.randomUUID()];
 try{
  await db`insert into provider_instances(id,provider,name,base_url) values(${service},'jellyfin','Completion fixture','https://fixture.invalid')`;
  for(const [index,id] of linked.entries())await db`insert into provider_connections(id,user_id,instance_id,status,external_user_id) values(${id},${index?member:admin},${service},'connected',${`external-${index}`})`;
  await db`insert into outbox_actions(user_id,connection_id,account_generation,kind,state,payload,created_at,updated_at)
    select user_id,id,account_generation,'jellyfin.sync','succeeded','{}'::jsonb,now()-interval '2 minutes',now()-interval '1 minute' from provider_connections where instance_id=${service}`;
  const [pending]=await db`insert into outbox_actions(user_id,connection_id,account_generation,kind,state,payload)
    select user_id,id,account_generation,'jellyfin.sync','pending','{}'::jsonb from provider_connections where id=${linked[0]} returning id`;
  const timing=()=>jobTimings().then(rows=>rows.find(row=>row.instanceId===service&&row.kind==='jellyfin.sync')!);
  expect(await timing()).toMatchObject({eligible:2,completed:1,fresh:0});
  await db`update outbox_actions set state='succeeded',updated_at=now() where id=${pending.id}`;
  expect((await timing()).completed).toBe(2);
  await db`update provider_connections set account_generation=${crypto.randomUUID()} where id=${linked[1]}`;
  expect((await timing()).completed).toBe(1);
 }finally{await db`delete from provider_instances where id=${service}`;}
});
