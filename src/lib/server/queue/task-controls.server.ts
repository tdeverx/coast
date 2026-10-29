import type { SQL } from 'bun';
import { getSql } from '../db';
import { requireAdmin, type SessionUser } from '../auth';
import { AppError } from '../security/errors';
import { resolveNotification } from '../notifications';
import { maintenanceKinds } from '#lib/providers/tasks.js';
import { taskControlLimit, jobIdentityScope, purposePriority, readJobPurpose, promotedPurpose } from '#lib/providers/job-policy.js';
import { updateJobRequestPriority } from '../security/request-priority';
import type { TaskControlAction } from '#lib/providers/task-control.js';
const sqlKinds = (kinds: readonly string[]) => `(${kinds.map(kind => `'${kind}'`).join(',')})`;
function transact<T>(tx: SQL | undefined, run: (sql: SQL) => Promise<T>): Promise<T> {
  return tx ? run(tx) : getSql().begin(run) as Promise<T>;
}
export function taskInstanceSql(action:string,connection:string) {
  return `coalesce(${connection}.instance_id::text,case when ${action}.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') then ${action}.payload->>'instanceId' end)`;
}
export function currentTaskGenerationSql(action:string,connection:string) {
  return `(${connection}.id is null or ${action}.account_generation is null or ${action}.account_generation=${connection}.account_generation)`;
}
/** Canonical retry conflicts also filter bounded bulk selection, so an old
 * blocked prefix cannot hide eligible jobs for other accounts. */
function retryConflictSql(action:string,connection:string){
  const instance=`coalesce(${connection}.instance_id::text,${action}.payload->>'instanceId')`;
  const shared=sqlKinds(maintenanceKinds.filter(kind=>jobIdentityScope(kind)==='instance'));
  return `(${action}.kind in ${sqlKinds(maintenanceKinds)} and ${instance} is not null and exists(
    select 1 from outbox_actions busy left join provider_connections busy_connection on busy_connection.id=busy.connection_id
    where busy.id<>${action}.id and busy.kind=${action}.kind and busy.state in ('pending','running')
      and ((${action}.kind in ${shared} and coalesce(busy_connection.instance_id::text,busy.payload->>'instanceId')=${instance})
        or (${action}.kind not in ${shared} and busy.connection_id is not distinct from ${action}.connection_id
          and busy.user_id=${action}.user_id and busy.account_generation is not distinct from ${action}.account_generation))))`;
}
export async function selectTaskTargets(db: SQL, kind: string, instanceId: string | null, action: TaskControlAction) {
  const states=action==='retry'?['failed']:action==='cancel'?['pending','failed']:['pending','running'];
  const rows=await db<{id:string}[]>`select outbox_actions.id from outbox_actions
    left join provider_connections on provider_connections.id=outbox_actions.connection_id
    where outbox_actions.kind=${kind} and ${db.unsafe(taskInstanceSql('outbox_actions','provider_connections'))} is not distinct from ${instanceId}
      and outbox_actions.state=any(${db.array(states,'TEXT')}) and ${db.unsafe(currentTaskGenerationSql('outbox_actions','provider_connections'))}
      and (${action}<>'promote' or coalesce(outbox_actions.payload->>'_jobPurpose','scheduled') in ('scheduled','live'))
      and (${action}<>'retry' or not ${db.unsafe(retryConflictSql('outbox_actions','provider_connections'))})
    order by outbox_actions.created_at,outbox_actions.id limit ${taskControlLimit+1}`;
  const blocked=action==='retry'&&(await db`select outbox_actions.id from outbox_actions
    left join provider_connections on provider_connections.id=outbox_actions.connection_id
    where outbox_actions.kind=${kind} and outbox_actions.state='failed'
      and ${db.unsafe(taskInstanceSql('outbox_actions','provider_connections'))} is not distinct from ${instanceId}
      and ${db.unsafe(currentTaskGenerationSql('outbox_actions','provider_connections'))}
      and ${db.unsafe(retryConflictSql('outbox_actions','provider_connections'))} limit 1`).length>0;
  return {ids:rows.slice(0,taskControlLimit).map(row=>row.id),hasMore:rows.length>taskControlLimit,blocked};
}

export async function cancelAction(actor: SessionUser | null, id: string, tx?: SQL) {
  const user = requireAdmin(actor);
  await transact(tx, async (sql) => {
    const [row] =
      await sql`UPDATE outbox_actions SET state = 'cancelled', updated_at = NOW() WHERE id = ${id} AND (user_id = ${user.id} OR ${user.role === 'admin'}) AND state IN ('pending', 'failed') RETURNING user_id`;
    if (!row)
      throw new AppError(
        409,
        'This action is no longer pending or does not belong to your account.'
      );
    await resolveNotification(row.user_id, `outbox:${id}`, sql);
  });
}
/** Raise an existing healthy job's urgency; never reset retry or service gates. */
export async function promoteAction(actor: SessionUser | null, id: string, tx?: SQL) {
  requireAdmin(actor);
  const result = await transact(tx, async sql=>{
    const [action]=await sql`select id,state,payload from outbox_actions where id=${id} for update`;
    if(!action || !['pending','running'].includes(action.state))throw new AppError(409,'This job is no longer waiting or running. Use Retry for a failed job.');
    const purpose=promotedPurpose(readJobPurpose(action.payload,'scheduled'),'manual');
    await sql`update outbox_actions set payload=payload||${{_manual:true,_jobPurpose:purpose}}::jsonb where id=${id}`;
    return {id,state:action.state,purpose};
  });
  if (!tx) updateJobRequestPriority(id,purposePriority(result.purpose));
  return result;
}
export async function retryAction(actor: SessionUser | null, id: string, tx?: SQL) {
  const user = requireAdmin(actor);
  await transact(tx, async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('provider-maintenance',0))`;
    const [action]=await sql`select a.*,coalesce(c.instance_id::text,a.payload->>'instanceId') as instance from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id=${id}`;
    if(!action)throw new AppError(409,'This action cannot be retried.');
    if(action.kind==='benchmark.run')throw new AppError(409,'Run a new benchmark in Benchmarking settings to preserve the recorded result.');
    if(maintenanceKinds.includes(action.kind)&&action.instance){
      const [busy]=await sql`select a.id from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id=${id} and ${getSql().unsafe(retryConflictSql('a','c'))}`;
      if(busy)throw new AppError(409,'This task is already queued or running for this service.');
    }
    const budget=action.kind==='webhook.deliver'&&action.state==='failed'?{_webhookAttemptBase:action.attempts}:{};
    const [row]=await sql`UPDATE outbox_actions SET state='pending',payload=payload||${budget}::jsonb||'{"_manual":true,"_jobPurpose":"manual"}'::jsonb,next_attempt_at=NOW(),updated_at=NOW() WHERE id=${id} AND (user_id=${user.id} OR ${user.role==='admin'}) AND state IN ('pending','failed') RETURNING id`;
    if(!row)throw new AppError(409,'This action cannot be retried.');
  });
}
