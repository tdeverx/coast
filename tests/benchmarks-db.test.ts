import {beforeAll,afterAll,expect,test} from 'bun:test';
import {getSql,closeDb} from '../src/lib/server/db';
import {startBenchmark,listBenchmarks,executeBenchmark} from '../src/lib/benchmarks/service.server';
import {claimNextAction,cancelAction,retryAction,registerActionHandler,runQueueOnce} from '../src/lib/server/queue';
import {contentRevision} from '../src/lib/server/content-revision.server';
import {collectionFreshnessSql} from '../src/lib/collection/freshness.server';
import {workAssessments} from '../src/lib/collection/query.server';
import {workSocial} from '../src/lib/social/queries.server';
import type {SessionUser} from '../src/lib/server/auth';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let actor:SessionUser,member:SessionUser,movie:string,list:string,connection:string;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const sql=getSql();
 const actors=await sql`insert into users(username,role) values('benchmark-admin','admin'),('benchmark-user','user') returning *`;
 actor=actors[0];member=actors[1];
 const [title]=await sql`insert into media(kind,title) values('movie','Benchmark fixture') returning id`;movie=title.id;
 await sql`insert into tracking_state(user_id,media_id,collected) values(${actor.id},${movie},true)`;
 const [saved]=await sql`insert into lists(user_id,name) values(${actor.id},'Fixture') returning id`;list=saved.id;
 await sql`insert into list_items(list_id,media_id,position) values(${list},${movie},1)`;
 const [instance]=await sql`insert into provider_instances(provider,name,base_url) values('jellyfin','Fixture','https://fixture.invalid') returning id`;
 const [linked]=await sql`insert into provider_connections(user_id,instance_id) values(${actor.id},${instance.id}) returning id`;connection=linked.id;
 registerActionHandler('benchmark.run',executeBenchmark);
});
afterAll(async()=>{if(actor)await closeDb();});
async function clearJobs(){await getSql()`update outbox_actions set state='cancelled' where kind='benchmark.run' and state in ('pending','running')`;await listBenchmarks(actor);}
async function claimed(){const result=await startBenchmark(actor);const action=await claimNextAction();expect(action?.id).toBe(result.run.actionId!);return {run:result.run,action:action!};}
run('only current enabled administrators may read or enqueue benchmarks',async()=>{
 await expect(startBenchmark(null)).rejects.toMatchObject({status:401});
 await expect(listBenchmarks(member)).rejects.toMatchObject({status:403});
 await expect(startBenchmark(member)).rejects.toMatchObject({status:403});
 await getSql()`update users set disabled=true where id=${actor.id}`;
 await expect(startBenchmark(actor)).rejects.toMatchObject({status:403});
 await expect(listBenchmarks(actor)).rejects.toMatchObject({status:403});
 await getSql()`update users set disabled=false where id=${actor.id}`;
});
run('near-simultaneous admission produces one durable run and one outbox job across SQL clients',async()=>{
 const results=await Promise.all(Array.from({length:12},()=>startBenchmark(actor)));
 expect(new Set(results.map(result=>result.run.id)).size).toBe(1);
 expect(results.filter(result=>!result.alreadyRunning)).toHaveLength(1);
 expect((await getSql()`select id from benchmark_runs where state in ('queued','running')`)).toHaveLength(1);
 expect((await getSql()`select id from outbox_actions where kind='benchmark.run' and state='pending'`)).toHaveLength(1);
 await cancelAction(actor,results[0].run.actionId!);
 const history=await listBenchmarks(actor);expect(history.runs.find(r=>r.id===results[0].run.id)?.state).toBe('cancelled');
});
run('a demoted or disabled actor is rejected again at execution',async()=>{
 for(const change of ['role','disabled']){
  const item=await claimed();
  if(change==='role')await getSql()`update users set role='user' where id=${actor.id}`;
  else await getSql()`update users set disabled=true where id=${actor.id}`;
  await expect(executeBenchmark(item.action)).rejects.toThrow('administrator-unavailable');
  const [record]=await getSql()`select * from benchmark_runs where id=${item.run.id}`;
  expect(record.state).toBe('failed');expect(record.measurements).toBeNull();
  await getSql()`update users set role='admin',disabled=false where id=${actor.id}`;await clearJobs();
 }
});
run('actual worker probes persist metrics without provider calls or domain writes',async()=>{
 const before=await getSql()`select jsonb_agg(t order by media_id)::text as value from tracking_state t where user_id=${actor.id}`;
 const revisions=await contentRevision(actor.id), originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;throw new Error('Provider calls forbidden in benchmark');}) as unknown as typeof fetch;
 let id:string;
 try {id=(await startBenchmark(actor)).run.id;expect(await runQueueOnce()).toBe(true);}finally{globalThis.fetch=originalFetch;}
 const record=(await listBenchmarks(actor)).runs.find(r=>r.id===id!);
 expect(record?.state).toBe('completed');expect(record?.errors).toEqual([]);expect(calls).toBe(0);
 expect(record?.context?.dataset.tracking).toBe(1);expect(record?.context?.build).toMatch(/sha256:/);
 expect(record?.measurements?.probes['Collection membership and page'].samplesMs).toHaveLength(5);
 expect(record?.measurements?.probes['Database round trip'].samplesMs).toHaveLength(10);
 expect(record?.measurements?.memoryAfter.rss).toBeGreaterThan(0);
 expect(await contentRevision(actor.id)).toEqual(revisions);
 expect(await getSql()`select jsonb_agg(t order by media_id)::text as value from tracking_state t where user_id=${actor.id}`).toEqual(before);
 await closeDb();expect((await listBenchmarks(actor)).runs.some(r=>r.id===id!)).toBe(true);
});
run('history records abandoned, missing and cancelled jobs and frees admission',async()=>{
 const item=await claimed();
 await getSql()`update benchmark_runs set state='running',started_at=now()-interval '6 minutes' where id=${item.run.id}`;
 await getSql()`update outbox_actions set locked_at=now()-interval '6 minutes' where id=${item.action.id}`;
 const history=await listBenchmarks(actor),record=history.runs.find(r=>r.id===item.run.id);
 expect(record?.state).toBe('failed');expect(record?.errors).toContain('interrupted');expect(history.activeId).toBeNull();
 const missing=await startBenchmark(actor);await getSql()`delete from outbox_actions where id=${missing.run.actionId}`;
 expect((await listBenchmarks(actor)).runs.find(r=>r.id===missing.run.id)?.state).toBe('failed');
});
run('a failed benchmark keeps its history and a new run uses fresh atomic admission',async()=>{
 const item=await claimed();
 await getSql()`update outbox_actions set state='failed' where id=${item.action.id}`;
 await getSql()`update benchmark_runs set state='failed',finished_at=now(),errors='["fixture-failure"]'::jsonb where id=${item.run.id}`;
 await expect(retryAction(actor,item.action.id)).rejects.toMatchObject({status:409});
 const replacement=await startBenchmark(actor);expect(replacement.run.id).not.toBe(item.run.id);
 const previous=(await listBenchmarks(actor)).runs.find(r=>r.id===item.run.id);
 expect(previous?.state).toBe('failed');expect(previous?.errors).toEqual(['fixture-failure']);
 await clearJobs();
});
run('a process restart can finish recovered queued work, while a stale lease cannot publish',async()=>{
 const item=await claimed();
 await getSql()`update benchmark_runs set state='running',started_at=now() where id=${item.run.id}`;
 await getSql()`update outbox_actions set attempts=attempts+1 where id=${item.action.id}`;
 await expect(executeBenchmark(item.action)).rejects.toThrow('job-lease-lost');
 const [unchanged]=await getSql()`select state from benchmark_runs where id=${item.run.id}`;expect(unchanged.state).toBe('running');
 const replacement={...item.action,attempts:item.action.attempts+1};await executeBenchmark(replacement);
 const [finished]=await getSql()`select state,errors from benchmark_runs where id=${item.run.id}`;
 expect(finished.state).toBe('completed');expect(finished.errors).toContain('restarted');await clearJobs();
});
run('durable revisions stay stable for polls/bookkeeping but detect deletes, reordering and provider content',async()=>{
 const before=await contentRevision(actor.id);expect(await contentRevision(actor.id)).toEqual(before);
 await getSql()`insert into sessions(user_id,token_hash,expires_at) values(${actor.id},'fixture-token',now()+interval '1 day')`;
 await getSql()`update provider_connections set credentials='fixture',settings=settings || '{"userSync":{"processed":100}}'::jsonb,updated_at=now() where id=${connection}`;
 await getSql()`insert into sync_checkpoints(connection_id,kind,cursor,scan_id) values(${connection},'jellyfin-user','100',null)`;
 const checkpoint=await contentRevision(actor.id);
 await getSql()`update sync_checkpoints set cursor='200',updated_at=now() where connection_id=${connection}`;
 expect(await contentRevision(actor.id)).toEqual(checkpoint);
 expect(checkpoint.tracking).not.toBe(before.tracking); // initial checkpoint admission
 await getSql()`update list_items set position=2 where list_id=${list}`;
 const reordered=await contentRevision(actor.id);expect(reordered.tracking).not.toBe(checkpoint.tracking);
 await getSql()`delete from list_items where list_id=${list}`;
 const deleted=await contentRevision(actor.id);expect(deleted.tracking).not.toBe(reordered.tracking);
 await getSql()`update tracking_state set position_seconds=10,updated_at=now() where user_id=${actor.id}`;
 const imported=await contentRevision(actor.id);expect(imported.tracking).not.toBe(deleted.tracking);
 await getSql()`update media set title='Changed metadata',updated_at=now() where id=${movie}`;
 const metadata=await contentRevision(actor.id);expect(metadata.tracking).not.toBe(imported.tracking);
 await getSql()`update media set updated_at=now() where id=${movie}`;
 expect(await contentRevision(actor.id)).toEqual(metadata);
});
run('revision ownership changes invalidate both old and new list owners',async()=>{
 const [second]=await getSql()`insert into lists(user_id,name) values(${member.id},'Other fixture') returning id`;
 const [entry]=await getSql()`insert into list_items(list_id,media_id,position) values(${list},${movie},1) returning id`;
 const ownerBefore=await contentRevision(actor.id),memberBefore=await contentRevision(member.id);
 await getSql()`update list_items set list_id=${second.id} where id=${entry.id}`;
 expect((await contentRevision(actor.id)).tracking).not.toBe(ownerBefore.tracking);
 expect((await contentRevision(member.id)).tracking).not.toBe(memberBefore.tracking);
});
run('opposite metadata/tracking transaction order commits without revision lock deadlocks',async()=>{
 const [other]=await getSql()`insert into media(kind,title) values('movie','Other lock fixture') returning id`;
 await getSql()`insert into tracking_state(user_id,media_id) values(${actor.id},${other.id})`;
 let firstReady!:()=>void,secondReady!:()=>void;
 const first=new Promise<void>(resolve=>{firstReady=resolve;}),second=new Promise<void>(resolve=>{secondReady=resolve;});
 const outcomes=await Promise.allSettled([
  getSql().begin(async db=>{await db`update media set title='Metadata first' where id=${movie}`;firstReady();await second;await db`update tracking_state set position_seconds=40 where user_id=${actor.id} and media_id=${other.id}`;}),
  getSql().begin(async db=>{await db`update tracking_state set position_seconds=50 where user_id=${actor.id} and media_id=${movie}`;secondReady();await first;await db`update media set title='Tracking first' where id=${other.id}`;}),
 ]);
 expect(outcomes.map(result=>result.status)).toEqual(['fulfilled','fulfilled']);
});
run('accepted-peer effective status changes invalidate while stable heartbeats do not',async()=>{
 const [a,b]=[actor.id,member.id].sort();
 await getSql()`insert into friendships(user_a,user_b,requested_by,state) values(${a},${b},${actor.id},'accepted')`;
 await getSql()`insert into user_presence(user_id,heartbeat_at,active_at) values(${member.id},now(),now())`;
 const online=await contentRevision(actor.id);
 await getSql()`update user_presence set heartbeat_at=now()+interval '1 second',active_at=now()+interval '1 second' where user_id=${member.id}`;
 expect(await contentRevision(actor.id)).toEqual(online);
 await getSql()`update user_presence set heartbeat_at=now(),active_at=now()-interval '6 minutes' where user_id=${member.id}`;
 const away=await contentRevision(actor.id);expect(away.social).not.toBe(online.social);expect(away.tracking).toBe(online.tracking);
 await getSql()`update user_presence set heartbeat_at=now()-interval '91 seconds' where user_id=${member.id}`;
 const offline=await contentRevision(actor.id);expect(offline.social).not.toBe(away.social);
 await getSql()`update user_presence set heartbeat_at=now(),active_at=now() where user_id=${member.id}`;
 await getSql()`update users set settings='{"activityStatus":"invisible"}'::jsonb where id=${member.id}`;
 const invisible=await contentRevision(actor.id);
 await getSql()`update user_presence set heartbeat_at=now()+interval '1 second' where user_id=${member.id}`;
 expect(await contentRevision(actor.id)).toEqual(invisible);
});
run('source freshness changes revision and assessment at clock boundaries without a database write',async()=>{
 const db=getSql();
 const [linked]=await db`select instance_id from provider_connections where id=${connection}`;
 await db`update provider_connections set status='connected' where id=${connection}`;
 const [item]=await db`insert into provider_items(instance_id,media_id,external_id,kind) values(${linked.instance_id},${movie},'freshness-fixture','movie') returning id`;
 await db`insert into availability(user_id,connection_id,provider_item_id,media_id,state) values(${actor.id},${connection},${item.id},${movie},'available')`;
 const signature=async()=>(await db`select ${collectionFreshnessSql(actor.id)} as value`)[0].value;
 const wait=()=>new Promise(resolve=>setTimeout(resolve,350));
 await db`update sync_checkpoints set scan_id=null,completed_at=now()-interval '20 minutes'+interval '250 milliseconds' where connection_id=${connection}`;
 const fresh=await contentRevision(actor.id),freshSignature=await signature();
 expect((await workAssessments(actor.id,actor.id,[movie]))[0].stale).toBe(false);
 expect(await contentRevision(actor.id)).toEqual(fresh);
 await wait();
 expect((await workAssessments(actor.id,actor.id,[movie]))[0].stale).toBe(true);
 expect((await contentRevision(actor.id)).tracking).not.toBe(fresh.tracking);expect(await signature()).not.toBe(freshSignature);
 await db`update sync_checkpoints set completed_at=now() where connection_id=${connection}`;
 await db`update availability set verified_at=now()-interval '20 minutes'+interval '250 milliseconds' where provider_item_id=${item.id}`;
 const positive=await contentRevision(actor.id),positiveSignature=await signature();
 expect((await workAssessments(actor.id,actor.id,[movie]))[0].stale).toBe(false);
 await wait();
 expect((await workAssessments(actor.id,actor.id,[movie]))[0].stale).toBe(true);
 expect((await contentRevision(actor.id)).tracking).not.toBe(positive.tracking);expect(await signature()).not.toBe(positiveSignature);
 await db`update sync_checkpoints set completed_at=now()-interval '1 day' where connection_id=${connection}`;
 await db`update availability set state='unavailable',source='{"authoritative":true}'::jsonb,verified_at=now()-interval '20 minutes'+interval '250 milliseconds' where provider_item_id=${item.id}`;
 const negative=await contentRevision(actor.id);
 expect((await workAssessments(actor.id,actor.id,[movie]))[0].availability).toBe('unavailable');
 await wait();
 expect((await workAssessments(actor.id,actor.id,[movie]))[0].availability).toBe('unknown');
 expect((await contentRevision(actor.id)).tracking).not.toBe(negative.tracking);
 await db`delete from availability where provider_item_id=${item.id}`;await db`delete from provider_items where id=${item.id}`;
});
run('public non-friend reactions and the viewed profile owner invalidate their visible content',async()=>{
 const db=getSql();
 const [publicOwner]=await db`insert into users(username,settings) values('public-revision-owner','{"social":{"audience":"public"}}'::jsonb) returning id,username`;
 const before=await contentRevision(actor.id);
 await db`insert into social_reactions(user_id,target_kind,target_id,emoji) values(${publicOwner.id},'work',${movie},'🔥')`;
 expect((await workSocial(actor.id,[movie]))[movie].reactions).toHaveLength(1);
 expect((await contentRevision(actor.id)).social).not.toBe(before.social);
 const visible=await contentRevision(actor.id);
 await db`update users set settings='{"social":{"audience":"private"}}'::jsonb where id=${publicOwner.id}`;
 expect((await workSocial(actor.id,[movie]))[movie].reactions).toHaveLength(0);
 expect((await contentRevision(actor.id)).social).not.toBe(visible.social);
 const hidden=await contentRevision(actor.id);
 await db`update social_reactions set emoji='❤️' where user_id=${publicOwner.id}`;
 expect(await contentRevision(actor.id)).toEqual(hidden);
 await db`update users set settings='{"social":{"audience":"public"}}'::jsonb where id=${publicOwner.id}`;
 const restored=await contentRevision(actor.id);
 await db`delete from social_reactions where user_id=${publicOwner.id}`;
 expect((await contentRevision(actor.id)).social).not.toBe(restored.social);
 const own=await contentRevision(actor.id),profile=await contentRevision(actor.id,publicOwner.username);
 await db`insert into tracking_state(user_id,media_id,collected,position_seconds) values(${publicOwner.id},${movie},true,30)`;
 expect((await contentRevision(actor.id)).tracking).toBe(own.tracking);
 expect((await contentRevision(actor.id,publicOwner.username)).tracking).not.toBe(profile.tracking);
 const shown=await contentRevision(actor.id,publicOwner.username);
 await db`update users set settings='{"social":{"audience":"private"}}'::jsonb where id=${publicOwner.id}`;
 expect((await contentRevision(actor.id,publicOwner.username)).tracking).not.toBe(shown.tracking);
 const privateProfile=await contentRevision(actor.id,publicOwner.username);
 await db`update tracking_state set position_seconds=45 where user_id=${publicOwner.id}`;
 expect(await contentRevision(actor.id,publicOwner.username)).toEqual(privateProfile);
 const [hiddenOwner]=await db`insert into users(username,settings) values('hidden-revision-owner','{"social":{"audience":"private"}}'::jsonb) returning id,username`;
 const hiddenWatch=await contentRevision(actor.id,hiddenOwner.username);
 await db`insert into tracking_state(user_id,media_id,collected) values(${hiddenOwner.id},${movie},true)`;
 expect(await contentRevision(actor.id,hiddenOwner.username)).toEqual(hiddenWatch);
});
run('private Steam content invalidates its owner while observation bookkeeping leaves all shelves stable',async()=>{
 const db=getSql();
 const [game]=await db`insert into games(title) values('Private revision fixture') returning id`;
 const [achievement]=await db`insert into game_achievements(game_id,provider,external_id,name) values(${game.id},'steam','fixture','Fixture') returning id`;
 const [account]=await db`insert into sync_accounts(user_id,provider,server_identity,external_user_id) values(${actor.id},'steam','fixture','fixture-revision-user') returning id`;
 const [observer]=await db`insert into users(username) values('unrelated-revision-observer') returning id`;
 const owner=await contentRevision(actor.id),other=await contentRevision(observer.id);
 await db`insert into game_account_state(account_id,game_id) values(${account.id},${game.id})`;
 await db`insert into game_achievement_progress(account_id,achievement_id,unlocked) values(${account.id},${achievement.id},false)`;
 const content=await contentRevision(actor.id);expect(content.tracking).not.toBe(owner.tracking);expect(await contentRevision(observer.id)).toEqual(other);
 await db`update game_account_state set observed_at=now(),achievements_attempted_at=now() where account_id=${account.id}`;
 await db`update game_achievement_progress set updated_at=now() where account_id=${account.id}`;
 await db`update sync_accounts set verified_at=now(),baselines='{"cursor":"fixture"}'::jsonb where id=${account.id}`;
 expect(await contentRevision(actor.id)).toEqual(content);expect(await contentRevision(observer.id)).toEqual(other);
 await db`update game_account_state set minutes_played=60 where account_id=${account.id}`;
 await db`update game_achievement_progress set unlocked=true,unlocked_at=now() where account_id=${account.id}`;
 const updated=await contentRevision(actor.id);expect(updated.tracking).not.toBe(content.tracking);expect(await contentRevision(observer.id)).toEqual(other);
 await db`delete from sync_accounts where id=${account.id}`;
 expect((await contentRevision(actor.id)).tracking).not.toBe(updated.tracking);expect(await contentRevision(observer.id)).toEqual(other);
});
run('fixed probe cohorts survive catalogue changes while Collection requires its exact cohort',async()=>{
 const first=(await startBenchmark(actor)).run.id;await runQueueOnce();
 await getSql()`update media set title='New cohort fixture' where id=${movie}`;
 const second=(await startBenchmark(actor)).run.id;await runQueueOnce();
 const secondRecord=(await listBenchmarks(actor)).runs.find(r=>r.id===second)!;
 expect(secondRecord.comparisons?.['Journal 6000 events']?.previousId).toBe(first);
 expect(secondRecord.comparisons?.['Database round trip']?.previousId).toBe(first);
 expect(secondRecord.comparisons?.['Collection membership and page']).toBeUndefined();
 const third=(await startBenchmark(actor)).run.id;await runQueueOnce();
 const thirdRecord=(await listBenchmarks(actor)).runs.find(r=>r.id===third)!;
 expect(thirdRecord.comparisons?.['Collection membership and page']?.previousId).toBe(second);
 expect(thirdRecord.comparisons?.['Journal 6000 events']?.previousId).toBe(second);
});
run('parallel deliveries execute only one probe workload and preserve its successful result',async()=>{
 const item=await claimed();
 const outcomes=await Promise.allSettled([executeBenchmark(item.action),executeBenchmark(item.action)]);
 expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const [record]=await getSql()`select state,errors from benchmark_runs where id=${item.run.id}`;
 expect(record.state).toBe('completed');expect(record.errors).toEqual([]);await clearJobs();
});
run('delayed transactions produce monotonically advancing revisions at commit',async()=>{
 const rows=await getSql()`insert into media(kind,title) values('movie','First order fixture'),('movie','Second order fixture') returning id`;
 for(const row of rows)await getSql()`insert into tracking_state(user_id,media_id) values(${actor.id},${row.id})`;
 const [before]=await getSql()`select revision::text as revision from content_revisions where scope=${actor.id} and domain='tracking'`;
 let ready!:()=>void,resume!:()=>void;
 const prepared=new Promise<void>(resolve=>{ready=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
 const delayed=getSql().begin(async db=>{await db`select txid_current()`;await db`update tracking_state set position_seconds=1 where user_id=${actor.id} and media_id=${rows[0].id}`;ready();await release;});
 await prepared;
 await getSql().begin(async db=>{await db`update tracking_state set position_seconds=2 where user_id=${actor.id} and media_id=${rows[1].id}`;});
 const [middle]=await getSql()`select revision::text as revision from content_revisions where scope=${actor.id} and domain='tracking'`;
 resume();await delayed;
 const [after]=await getSql()`select revision::text as revision from content_revisions where scope=${actor.id} and domain='tracking'`;
 expect(BigInt(middle.revision)).toBe(BigInt(before.revision)+1n);
 expect(BigInt(after.revision)).toBe(BigInt(middle.revision)+1n);
});
run('database read-only probes reject accidental writes from called SQL functions',async()=>{
 const sql=getSql();
 const [saved]=await sql`select pg_get_functiondef('social_visible(uuid,uuid,text,text)'::regprocedure) as definition`;
 const before=await sql`select * from up_next where user_id=${actor.id}`;
 try{
  await sql.unsafe(`create or replace function social_visible(owner_id uuid,viewer_id uuid,section_name text,category_name text default null) returns boolean language plpgsql volatile as $$ begin insert into up_next(user_id,media_id) values(owner_id,'${movie}') on conflict do nothing;return true;end;$$`);
  const item=await claimed();await expect(executeBenchmark(item.action)).rejects.toThrow('probe-failed');
  expect(await sql`select * from up_next where user_id=${actor.id}`).toEqual(before);
  const [record]=await sql`select state,measurements,errors from benchmark_runs where id=${item.run.id}`;
  expect(record.state).toBe('failed');expect(record.measurements.wallMs).toBeGreaterThan(0);
 }finally{await sql.unsafe(saved.definition);await clearJobs();}
});
run('metadata overrides use their media key and account cascades preserve benchmark history',async()=>{
 await getSql()`insert into metadata_overrides(media_id,title,updated_by) values(${movie},'Override',${actor.id})`;
 const before=await contentRevision(actor.id);
 await getSql()`update metadata_overrides set title='Changed override',updated_at=now() where media_id=${movie}`;
 expect((await contentRevision(actor.id)).tracking).not.toBe(before.tracking);
 const [count]=await getSql()`select count(*)::int as total from benchmark_runs`;
 await getSql()`delete from users where id=${actor.id}`;
 expect((await getSql()`select count(*)::int as total from benchmark_runs`)[0].total).toBe(count.total);
 expect((await getSql()`select updated_by from metadata_overrides where media_id=${movie}`)[0].updated_by).toBeNull();
 expect(await getSql()`select * from content_revisions where scope=${actor.id}`).toHaveLength(0);
 expect(await getSql()`select * from content_revision_changes`).toHaveLength(0);
});
