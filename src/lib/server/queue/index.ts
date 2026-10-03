import { maintenanceKinds } from '$lib/providers/tasks';
import { requestPriority, type RequestPriority } from '../security/request-priority';
import { context, logDiagnostic, classifyFailure } from '../diagnostics';
import { refreshDiagnosticConfig } from '../config';
import { correlationId } from '../../diagnostics';
import { desc, eq, sql, inArray } from 'drizzle-orm';
import { getDb, getSql } from '../db';
import { outboxActions, providerConnections, providerInstances, users } from '../db/schema';
import { requireAdmin, type SessionUser } from '../auth';
import { AppError } from '../security/errors';
import { ProviderHttpError } from '../security/provider-fetch';
import { notify, resolveNotification } from '../notifications';
import * as v from 'valibot';

export interface OutboxAction {
  id: string;
  userId: string;
  connectionId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  accountGeneration?: string | null;
  attempts: number;
  correlationId: string;
  instanceId?: string | null;
  priority?: RequestPriority;
}
export type JobOutcome = { checked?: number; added?: number; refreshed?: number; deferred?: number };
export type ActionHandler = (action: OutboxAction) => Promise<void | JobOutcome>;

const handlers = new Map<string, ActionHandler>();
export class PermanentActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentActionError';
  }
}
export function registerActionHandler(kind: string, handler: ActionHandler) {
  handlers.set(kind, handler);
}
export async function enqueueAction(input: {
  userId: string;
  connectionId?: string | null;
  kind: string;
  payload: Record<string, unknown>;
  compactionKey?: string;
}): Promise<string> {
  if (
    !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(input.kind) ||
    JSON.stringify(input.payload).length > 262_144
  )
    throw new AppError(400, 'Invalid external action.');
  return getSql().begin(async (sql) => {
    if (maintenanceKinds.includes(input.kind)) await sql`SELECT pg_advisory_xact_lock(hashtextextended('provider-maintenance',0))`;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.connectionId || 'local'}`}, 0))`;
    if (input.connectionId) {
      const [connection] =
        await sql`SELECT id FROM provider_connections WHERE id = ${input.connectionId} AND user_id = ${input.userId}`;
      if (!connection) throw new AppError(403, 'This connection does not belong to this account.');
    }
    if (maintenanceKinds.includes(input.kind)) {
      const [existing] =
        await sql`SELECT a.id FROM outbox_actions a LEFT JOIN provider_connections c ON c.id=a.connection_id
          WHERE a.kind=${input.kind} AND (
            (a.user_id=${input.userId} AND a.connection_id IS NOT DISTINCT FROM ${input.connectionId||null}::uuid AND a.state IN ('pending','running','failed')) OR
            (a.state IN ('pending','running') AND (
              (${input.connectionId||null}::uuid IS NOT NULL AND c.instance_id=(SELECT instance_id FROM provider_connections WHERE id=${input.connectionId||null}::uuid)) OR
              (${input.kind}='tmdb.refresh' AND a.payload->>'instanceId'=${typeof input.payload.instanceId==='string'?input.payload.instanceId:null})
            ))
          ) LIMIT 1`;
      if (existing) return existing.id;
    }
    if (input.compactionKey) {
      const replaced =
        await sql`UPDATE outbox_actions SET state = 'cancelled', last_error = 'Replaced by a newer pending edit.', updated_at = NOW()
        WHERE user_id = ${input.userId} AND connection_id IS NOT DISTINCT FROM ${input.connectionId || null}::uuid AND state = 'pending' AND compaction_key = ${input.compactionKey} RETURNING id`;
      for (const old of replaced)
        await sql`DELETE FROM notifications WHERE user_id = ${input.userId} AND source_key = ${`outbox:${old.id}`}`;
    }
    const [row] =
      await sql`INSERT INTO outbox_actions (user_id, connection_id, kind, payload, compaction_key, created_at, correlation_id)
      VALUES (${input.userId}, ${input.connectionId || null}, ${input.kind}, ${input.payload}::jsonb, ${input.compactionKey || null}, clock_timestamp(), ${correlationId(context.getStore())}) RETURNING id`;
    return row.id;
  });
}

/** Safe, actionable descriptions without leaking provider response bodies. */
export function jobFailureMessage(error: unknown, permanent: boolean) {
  if (error instanceof ProviderHttpError) {
    if (error.status === 401) return 'Authentication failed. Reconnect this account in Connections before retrying.';
    if (error.status === 403) return 'Access denied. Check this account’s service permissions before retrying.';
    if ([404, 410].includes(error.status)) return 'The requested item or endpoint is unavailable. Check the source or metadata mapping.';
    if (error.status === 429) return 'Service rate limit reached. Coast will retry after the service cooldown.';
    if (error.status >= 500) return 'The service is unavailable. Coast will retry automatically.';
  }
  if (error instanceof AppError && error.code === 'steam_private') return 'Steam game details are private or unavailable. Make game details readable in Steam privacy settings; previous imports are retained.';
  if (error instanceof v.ValiError) return 'The service returned unsupported data. Review diagnostics before retrying.';
  if (safeDiagnosticErrorCode(error) === 'catalogue.identity-conflict') return 'Conflicting metadata identities need administrator review. Retrying cannot resolve the mapping.';
  return permanent ? 'This action could not be accepted. Review the connection and diagnostics before retrying.' : 'The connection was interrupted. Coast will retry automatically.';
}

export type JobFailure = { code: string; remedy: 'connection' | 'permissions' | 'metadata' | 'retry'; retryable: boolean };
export function jobFailureDetail(error: unknown, permanent: boolean): JobFailure {
  if(error instanceof AppError && error.code === 'steam_private')return {code:'provider.permission',remedy:'permissions',retryable:false};
  const status = error instanceof ProviderHttpError ? error.status : undefined;
  if (status === 401) return { code: 'provider.authentication', remedy: 'connection', retryable: false };
  if (status === 403) return { code: 'provider.permission', remedy: 'permissions', retryable: false };
  if (status === 404 || status === 410) return { code: 'provider.item-unavailable', remedy: 'metadata', retryable: false };
  if (status === 429) return { code: 'provider.rate-limit', remedy: 'retry', retryable: true };
  if (status && status >= 500) return { code: 'provider.unavailable', remedy: 'retry', retryable: true };
  if (error instanceof v.ValiError) return { code: 'provider.invalid-data', remedy: 'metadata', retryable: false };
  const code = safeDiagnosticErrorCode(error);
  if (code === 'catalogue.identity-conflict') return { code, remedy: 'metadata', retryable: false };
  return { code: code ?? (permanent ? 'action.rejected' : 'provider.interrupted'), remedy: 'retry', retryable: !permanent };
}

export function retryDelayMs(attempt: number): number {
  return Math.min(6 * 60 * 60_000, 5000 * 2 ** Math.min(13, Math.max(0, attempt - 1)));
}

/** Include only schema paths and value types; never persist rejected provider values. */
export function validationDiagnostic(error: unknown) {
  if (!(error instanceof v.ValiError)) return undefined;
  return error.issues.slice(0, 12).map((issue) => ({
    path:
      issue.path
        ?.map((segment: { key: unknown }) =>
          typeof segment.key === 'string' || typeof segment.key === 'number'
            ? String(segment.key)
            : '?'
        )
        .join('.') || '(root)',
    expected: issue.expected,
    receivedType:
      issue.input === null ? 'null' : Array.isArray(issue.input) ? 'array' : typeof issue.input,
  }));
}

/** Map known scan invariants to stable codes without exposing arbitrary error messages. */
export function safeDiagnosticErrorCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const codes: Record<string, string> = {
    'Jellyfin returned an incomplete library page.': 'jellyfin.incomplete-library-page',
    'Jellyfin returned a cyclic media hierarchy.': 'jellyfin.cyclic-media-hierarchy',
    'Jellyfin returned an item without its show identity.': 'jellyfin.item-missing-show-identity',
    'Conflicting provider identities require administrator review.': 'catalogue.identity-conflict',
    'A season requires its canonical show.': 'catalogue.season-missing-show',
    'An episode requires its canonical show.': 'catalogue.episode-missing-show',
  };
  return codes[error.message];
}

/** A short, controlled execution phase helps diagnose failures without storing error text. */
export function tagDiagnosticStage(error: unknown, stage: string) {
  if (error && typeof error === 'object') {
    Object.defineProperty(error, 'diagnosticStage', { value: stage, configurable: true });
  }
  return error;
}

function safeDiagnosticStage(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const stage = (error as { diagnosticStage?: unknown }).diagnosticStage;
  return typeof stage === 'string' && /^[a-z-]{1,40}$/.test(stage) ? stage : undefined;
}

export async function claimNextAction(urgentOnly=false): Promise<OutboxAction | null> {
  // Serialize claims, preserve mutable account ordering, and prioritize initial imports.

  return getSql().begin(async (sql) => {
  const priority=sql`CASE WHEN candidate.kind IN ('jellyfin.sync','trakt.import','trakt.lists-import','steam.sync') AND NOT EXISTS (SELECT 1 FROM sync_checkpoints checkpoint WHERE checkpoint.connection_id=candidate.connection_id AND checkpoint.kind='initial:'||candidate.kind||':'||coalesce(candidate.account_generation,connection.account_generation)::text AND checkpoint.completed_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM outbox_actions completed WHERE completed.connection_id=candidate.connection_id AND completed.kind=candidate.kind AND completed.account_generation IS NOT DISTINCT FROM candidate.account_generation AND completed.state='succeeded') THEN 0 WHEN candidate.kind NOT IN ${sql(maintenanceKinds)} THEN 1 WHEN candidate.kind LIKE '%.live' THEN 2 ELSE 3 END`;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('queue-claim', 0))`;
    await sql`UPDATE outbox_actions SET state = 'pending', locked_at = NULL, next_attempt_at = NOW(), updated_at = NOW()
      WHERE state = 'running' AND locked_at < NOW() - INTERVAL '5 minutes'`;
    const [row] =
      await sql`UPDATE outbox_actions SET state = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT candidate.id FROM outbox_actions candidate
        LEFT JOIN provider_connections connection ON connection.id = candidate.connection_id
        LEFT JOIN provider_instances instance ON instance.id = connection.instance_id OR (candidate.kind = 'tmdb.refresh' AND instance.provider = 'tmdb' AND instance.id::text = candidate.payload->>'instanceId')
        WHERE candidate.state = 'pending' AND candidate.next_attempt_at <= NOW()
          AND (${urgentOnly} = false OR ${priority} < 3)
          AND (instance.settings->>'jobsRetryAt' IS NULL OR (instance.settings->>'jobsRetryAt')::timestamptz <= NOW())
          AND (candidate.kind LIKE '%.live' OR NOT EXISTS (SELECT 1 FROM outbox_actions earlier
            WHERE earlier.user_id = candidate.user_id AND earlier.connection_id IS NOT DISTINCT FROM candidate.connection_id
            AND earlier.kind NOT LIKE '%.live' AND earlier.state IN ('pending', 'running', 'failed') AND (earlier.created_at, earlier.id) < (candidate.created_at, candidate.id)
            AND (earlier.kind NOT IN ${sql(maintenanceKinds)} OR earlier.state = 'running' OR
              (${priority} <> 0 AND candidate.kind IN ${sql(maintenanceKinds)} AND earlier.state = 'pending' AND earlier.next_attempt_at <= NOW()))))
        ORDER BY ${priority}, candidate.created_at, candidate.id FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
      ) RETURNING *, coalesce((SELECT instance_id FROM provider_connections WHERE id = connection_id), (SELECT id FROM provider_instances WHERE kind='tmdb.refresh' AND provider='tmdb' AND id::text=payload->>'instanceId')) AS instance_id`;
    const initial = row && ['jellyfin.sync','trakt.import','trakt.lists-import','steam.sync'].includes(row.kind)
      ? (await sql`SELECT NOT EXISTS(SELECT 1 FROM outbox_actions WHERE connection_id=${row.connection_id} AND kind=${row.kind} AND account_generation IS NOT DISTINCT FROM ${row.account_generation}::uuid AND state='succeeded') AND NOT EXISTS(SELECT 1 FROM sync_checkpoints WHERE connection_id=${row.connection_id} AND kind=${'initial:'+row.kind+':'+row.account_generation} AND completed_at IS NOT NULL) AS first`)[0].first : false;
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          connectionId: row.connection_id,
          kind: row.kind,
          payload: row.payload,
          accountGeneration: row.account_generation,
          attempts: row.attempts,
          correlationId: row.correlation_id,
          instanceId: row.instance_id,
          priority: initial ? 0 : !maintenanceKinds.includes(row.kind) ? 1 : row.kind.endsWith('.live') ? 2 : 3,
        }
      : null;
  });
}

export async function runQueueOnce(urgentOnly=false): Promise<boolean> {
  const action = await claimNextAction(urgentOnly);
  if (!action) return false;
  // Keep account writes ordered. Read-only live observations can interleave with imports.
  const reserved = await getSql().reserve();
  const lockKeys = [`queue-lane:${action.userId}:${action.connectionId ?? 'local'}${action.kind.endsWith('.live') ? ':live' : ''}`];
  const held: string[] = [];
  try {
    for (const key of lockKeys) {
      const [lock] =
        await reserved`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`;
      if (!lock.acquired) {
        await getSql()`UPDATE outbox_actions SET state = 'pending', locked_at = NULL, attempts = attempts - 1, next_attempt_at = NOW() + INTERVAL '2 seconds' WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts}`;
        return true;
      }
      held.push(key);
    }
    await refreshDiagnosticConfig();
    return await requestPriority.run(action.priority??1, () => context.run(action.correlationId, async () => {
      const started = performance.now();
      void logDiagnostic('debug', 'job.start', { actionId: action.id, attempts: action.attempts });
      const heartbeat = setInterval(() => {
        void reserved`UPDATE outbox_actions SET locked_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts}`.catch(
          () => {}
        );
      }, 20_000);
      heartbeat.unref();
      try {
        if (action.connectionId) {
          const [connection] =
            await getSql()`SELECT c.id, c.account_generation, c.credentials, i.provider FROM provider_connections c JOIN provider_instances i ON i.id = c.instance_id JOIN users u ON u.id = c.user_id
          WHERE c.id = ${action.connectionId} AND c.user_id = ${action.userId} AND c.status = 'connected' AND i.enabled AND NOT u.disabled`;
          if (
            !connection ||
            (action.accountGeneration && action.accountGeneration !== connection.account_generation) ||
            (['jellyfin', 'trakt'].includes(connection.provider) && !connection.credentials)
          )
            throw new PermanentActionError('The connected account is unavailable.');
        }
        const handler = handlers.get(action.kind);
        if (!handler) throw new PermanentActionError('This action type is no longer supported.');
        const outcome = await handler(action);
        await getSql().begin(async (sql) => {
          const completed =
            await sql`UPDATE outbox_actions SET state = 'succeeded', locked_at = NULL, last_error = NULL, payload = (payload - '_jobFailure') || ${outcome ? { _jobOutcome: outcome } : {}}::jsonb, updated_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id`;
          if (completed.length && action.priority===0 && action.connectionId && action.accountGeneration)
            await sql`INSERT INTO sync_checkpoints(connection_id,kind,completed_at) VALUES(${action.connectionId},${'initial:'+action.kind+':'+action.accountGeneration},NOW()) ON CONFLICT(connection_id,kind) DO UPDATE SET completed_at=NOW(),updated_at=NOW()`;
          if (completed.length)
            await resolveNotification(action.userId, `outbox:${action.id}`, sql);
        });
        void logDiagnostic('info', 'job.complete', {
          actionId: action.id,
          accountGeneration: action.accountGeneration,
          attempts: action.attempts,
          durationMs: performance.now() - started,
        });
      } catch (error) {
        void logDiagnostic('error', 'job.failed', {
          actionId: action.id,
          accountGeneration: action.accountGeneration,
          attempts: action.attempts,
          failure: classifyFailure(error),
          status: error instanceof ProviderHttpError ? error.status : undefined,
          errorCode: safeDiagnosticErrorCode(error) ?? jobFailureDetail(error, error instanceof PermanentActionError).code,
          stage: safeDiagnosticStage(error),
          durationMs: performance.now() - started,
        });
        const permanent =
          safeDiagnosticErrorCode(error) === 'catalogue.identity-conflict' ||
          (error instanceof AppError && error.code === 'steam_private') ||
          error instanceof PermanentActionError ||
          error instanceof v.ValiError ||
          (error instanceof ProviderHttpError &&
            [400, 401, 403, 404, 405, 409, 410, 422].includes(error.status));
        const message = jobFailureMessage(error, permanent);
        const failure = jobFailureDetail(error, permanent);
        const retryAfter =
          error instanceof ProviderHttpError
            ? Math.min(86_400_000, Math.max(0, (error.retryAfterSeconds || 0) * 1000))
            : 0;
        const next = new Date(Date.now() + Math.max(retryDelayMs(action.attempts), retryAfter));
        await getSql().begin(async (sql) => {
          const failed =
            await sql`UPDATE outbox_actions SET state = ${permanent ? 'failed' : 'pending'}, next_attempt_at = ${next}, locked_at = NULL, last_error = ${message}, payload = payload || ${{ _jobFailure: failure }}::jsonb, updated_at = NOW()
        WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id`;
          if (!failed.length) return; // A recovered lease owns the outcome now.
          if (
            action.instanceId &&
            retryAfter > 0 &&
            error instanceof ProviderHttpError &&
            [429, 503].includes(error.status)
          ) {
            const until = new Date(Date.now() + retryAfter).toISOString();
            await sql`UPDATE provider_instances SET settings = jsonb_set(settings, '{jobsRetryAt}', to_jsonb(GREATEST(COALESCE(settings->>'jobsRetryAt', ''), ${until})::text), true) WHERE id = ${action.instanceId}`;
          }
          if (permanent || action.attempts >= 3)
            await notify(
              {
                userId: action.userId,
                kind: 'external-action',
                title: permanent
                  ? 'An external action needs attention'
                  : 'Waiting for a connected service',
                body: message,
                level: 'normal',
                sourceKey: `outbox:${action.id}`,
                data:{actorId:action.userId,subjectId:action.id,destination:'/settings/jobs'},
              },
              sql
            );
        });
      } finally {
        clearInterval(heartbeat);
      }
      return true;
    }));
  } finally {
    try {
      for (const key of held.reverse())
        await reserved`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
    } finally {
      reserved.release();
    }
  }
}

let running = false;
let workerGeneration = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();
/** A small worker pool lets unrelated connections progress while one service scans a library. */
export function startQueueWorker() {
  if (running) return;
  running = true;
  const generation = ++workerGeneration;
  const schedule = (delay: number, urgentOnly=false) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      void tick(urgentOnly);
    }, delay);
    timers.add(timer);
    timer.unref();
  };
  const tick = async (urgentOnly:boolean) => {
    if (!running || generation !== workerGeneration) return;
    let worked = false;
    try {
      worked = await runQueueOnce(urgentOnly);
    } catch {
      /* Retain work during database outages. */
    }
    if (running && generation === workerGeneration) schedule(worked ? 20 : 2000,urgentOnly);
  };
  for (let worker = 0; worker < 3; worker++) schedule(worker * 50,worker===0);
}
export function stopQueueWorker() {
  running = false;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

export async function listActions(actor: SessionUser | null) {
  requireAdmin(actor);
  // Bound each indexed state query before joining credentials-free display data. This
  // avoids sorting the entire completed playback history on every settings poll.
  const states = ['running', 'pending', 'failed', 'succeeded', 'cancelled'] as const;
  const recent = await Promise.all(
    states.map((state) =>
      getDb()
        .select({
          id: outboxActions.id,
          state: outboxActions.state,
          createdAt: outboxActions.createdAt,
        })
        .from(outboxActions)
        .where(eq(outboxActions.state, state))
        .orderBy(desc(outboxActions.createdAt))
        .limit(200)
    )
  );
  const ids = recent
    .flat()
    .sort(
      (a, b) =>
        Number(['succeeded', 'cancelled'].includes(a.state)) -
          Number(['succeeded', 'cancelled'].includes(b.state)) ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    .slice(0, 200)
    .map((row) => row.id);
  if (!ids.length) return [];
  return getDb()
    .select({
      progress: sql<{
        processed?: number;
        total?: number | null;
        phase?: string;
      } | null>`case when ${outboxActions.kind}='tmdb.refresh' and (${providerInstances.settings}->'metadataScan'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerInstances.settings}->'metadataScan'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerInstances.settings}->'metadataScan' when ${outboxActions.kind}='jellyfin.library' and (${providerInstances.settings}->'libraryScan'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerInstances.settings}->'libraryScan'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerInstances.settings}->'libraryScan' when ${outboxActions.kind}='jellyfin.sync' and (${providerConnections.settings}->'userSync'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerConnections.settings}->'userSync'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerConnections.settings}->'userSync' else null end`,
      failure: sql<JobFailure | null>`${outboxActions.payload}->'_jobFailure'`,
      outcome: sql<JobOutcome | null>`${outboxActions.payload}->'_jobOutcome'`,
      instanceId: providerInstances.id,
      provider: providerInstances.provider,
      updatedAt: outboxActions.updatedAt,
      connectionLabel: sql<string>`concat(coalesce(${providerInstances.name},'Coast'), ' · ', ${users.username})`,
      id: outboxActions.id,
      userId: outboxActions.userId,
      connectionId: outboxActions.connectionId,
      kind: outboxActions.kind,
      state: outboxActions.state,
      attempts: outboxActions.attempts,
      lastError: outboxActions.lastError,
      serviceRetryAt: sql<Date | null>`(${providerInstances.settings}->>'jobsRetryAt')::timestamptz`,
      nextAttemptAt: sql<Date>`greatest(${outboxActions.nextAttemptAt}, (${providerInstances.settings}->>'jobsRetryAt')::timestamptz)`,
      createdAt: outboxActions.createdAt,
    })
    .from(outboxActions)
    .innerJoin(users, eq(users.id, outboxActions.userId))
    .leftJoin(providerConnections, eq(providerConnections.id, outboxActions.connectionId))
    .leftJoin(providerInstances, sql`${providerInstances.id}=${providerConnections.instanceId} or (${outboxActions.kind}='tmdb.refresh' and ${providerInstances.provider}='tmdb' and ${providerInstances.id}::text=${outboxActions.payload}->>'instanceId')`)
    .where(inArray(outboxActions.id, ids))
    .orderBy(
      sql`case when ${outboxActions.state} in ('running', 'pending', 'failed') then 0 else 1 end`,
      desc(outboxActions.createdAt)
    )
    .limit(200);
}
export async function cancelAction(actor: SessionUser | null, id: string) {
  const user = requireAdmin(actor);
  await getSql().begin(async (sql) => {
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
export async function retryAction(actor: SessionUser | null, id: string) {
  const user = requireAdmin(actor);
  await getSql().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('provider-maintenance',0))`;
    const [action]=await sql`select a.*,coalesce(c.instance_id::text,a.payload->>'instanceId') as instance from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id=${id}`;
    if(!action)throw new AppError(409,'This action cannot be retried.');
    if(maintenanceKinds.includes(action.kind)&&action.instance){
      const [busy]=await sql`select a.id from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id<>${id} and a.kind=${action.kind} and a.state in ('pending','running') and coalesce(c.instance_id::text,a.payload->>'instanceId')=${action.instance} limit 1`;
      if(busy)throw new AppError(409,'This task is already queued or running for this service.');
    }
    const [row]=await sql`UPDATE outbox_actions SET state='pending',next_attempt_at=NOW(),updated_at=NOW() WHERE id=${id} AND (user_id=${user.id} OR ${user.role==='admin'}) AND state IN ('pending','failed') RETURNING id`;
    if(!row)throw new AppError(409,'This action cannot be retried.');
  });
}
