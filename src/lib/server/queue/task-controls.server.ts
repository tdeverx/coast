import { traktJobAllowed } from '#lib/providers/trakt/access.js';
import type { SQL } from 'bun';
import { getSql } from '../db';
import { requireAdmin, type SessionUser } from '../auth';
import { AppError } from '../security/errors';
import { resolveNotification } from '../notifications';
import { maintenanceKinds } from '#lib/providers/tasks.js';
import { isConfirmedRequestDenial, requestDestinationLock } from '#lib/providers/contracts.js';
import { taskControlLimit, jobIdentityScope, purposePriority, readJobPurpose, promotedPurpose } from '#lib/providers/job-policy.js';
import { updateJobRequestPriority } from '../security/request-priority';
import type { TaskControlAction } from '#lib/providers/task-control.js';
const sqlKinds = (kinds: readonly string[]) => `(${kinds.map(kind => `'${kind}'`).join(',')})`;
function transact<T>(tx: SQL | undefined, run: (sql: SQL) => Promise<T>): Promise<T> {
  return tx ? run(tx) : getSql().begin(run) as Promise<T>;
}
export function taskInstanceSql(action:string,connection:string) {
  return `coalesce(${connection}.instance_id::text,case when ${action}.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata','trakt.air-schedule') then ${action}.payload->>'instanceId' end)`;
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
      await sql`UPDATE outbox_actions SET state = 'cancelled', updated_at = NOW() WHERE id = ${id} AND (user_id = ${user.id} OR ${user.role === 'admin'}) AND state IN ('pending', 'failed') RETURNING user_id,kind,payload`;
    if (!row)
      throw new AppError(
        409,
        'This action is no longer pending or does not belong to your account.'
      );
    if(row.kind==='seerr.request' && isConfirmedRequestDenial(row.payload._jobFailure?.code))
      await sql`update media_requests set state='cancelled',updated_at=now() where id=${row.payload.requestId}::uuid
        and user_id=${row.user_id} and external_id is null and state in ('pending','failed')`;
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
    const [action]=await sql`select a.*,coalesce(c.instance_id::text,a.payload->>'instanceId') as instance, i.provider,case when c.settings ? 'traktSync' then jsonb_build_object('traktSync',c.settings->'traktSync')
              when c.settings ? 'traktAccess' then jsonb_build_object('traktAccess',c.settings->'traktAccess') else '{}'::jsonb end as trakt_scope from outbox_actions a left join provider_connections c on c.id=a.connection_id left join provider_instances i on i.id=c.instance_id where a.id=${id} for update of a`;
    if(!action)throw new AppError(409,'This action cannot be retried.');
    if(action.provider==='trakt' && !traktJobAllowed(action.trakt_scope, action.kind, action.payload))
      throw new AppError(403,'This sync operation is disabled in your Trakt connection settings.','feature_disabled');
    if(action.kind==='benchmark.run')throw new AppError(409,'Run a new benchmark in Benchmarking settings to preserve the recorded result.');
    if(maintenanceKinds.includes(action.kind)&&action.instance){
      const [busy]=await sql`select a.id from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id=${id} and ${getSql().unsafe(retryConflictSql('a','c'))}`;
      if(busy)throw new AppError(409,'This task is already queued or running for this service.');
    }
    const budget=action.kind==='webhook.deliver'&&action.state==='failed'?{_webhookAttemptBase:action.attempts}:{};
    const [row]=await sql`UPDATE outbox_actions SET state='pending',payload=payload||${budget}::jsonb||'{"_manual":true,"_jobPurpose":"manual"}'::jsonb,next_attempt_at=NOW(),updated_at=NOW() WHERE id=${id} AND (user_id=${user.id} OR ${user.role==='admin'}) AND state IN ('pending','failed') RETURNING id`;
    if(!row)throw new AppError(409,'This action cannot be retried.');
    if(action.kind==='seerr.request' && action.state==='failed' && isConfirmedRequestDenial(action.payload._jobFailure?.code)){
      const [request]=await sql`select media_id,instance_id,server_id,is_4k from media_requests where id=${action.payload.requestId}::uuid and user_id=${action.user_id}`;
      if(!request)throw new AppError(409,'The original request no longer exists.');
      // Serialise with fresh requests so a retry cannot silently restore a replaced season selection.
      await sql`select pg_advisory_xact_lock(hashtextextended(${requestDestinationLock(request.media_id,request.instance_id,request.server_id,request.is_4k)},0))`;
      const [restored]=await sql`update media_requests r set state='pending',updated_at=now()
        where r.id=${action.payload.requestId}::uuid and r.user_id=${action.user_id} and r.state='failed' and r.external_id is null
        and coast_job_allowed(${action.user_id}::uuid,'seerr.request',${action.payload}::jsonb)
        and exists(select 1 from provider_connections c join provider_instances i on i.id=c.instance_id and i.enabled
          where c.id=${action.connection_id}::uuid and c.user_id=r.user_id and c.instance_id=r.instance_id
            and c.status='connected' and c.account_generation=${action.account_generation}::uuid)
        and not exists(select 1 from media_requests other where other.id<>r.id and other.media_id=r.media_id
          and other.instance_id=r.instance_id and other.server_id is not distinct from r.server_id and other.is_4k=r.is_4k
          and (cardinality(r.seasons)=0 or other.seasons&&r.seasons)
          and (other.state in ('pending','approved','processing','available') or other.user_id=r.user_id and other.created_at>r.created_at))
        returning id`;
      if(!restored)throw new AppError(409,'The request or its account has changed. Review the current request before retrying.');
    }
  });
}
