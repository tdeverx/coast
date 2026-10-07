import { maintenanceKinds, serviceTraversalKinds } from '$lib/providers/tasks';
import { jobIdentityScope, purposePriority, readJobPurpose, promotedPurpose, type JobPurpose } from '$lib/providers/job-policy';
import { jobExecution, JobYield } from './execution';
import { requestPriority, providerJob, registerJobRequestPriority, updateJobRequestPriority, releaseJobRequestPriority, type RequestPriority } from '../security/request-priority';
import { context, logDiagnostic, classifyFailure } from '../diagnostics';
import { refreshDiagnosticConfig,getConfig } from '../config';
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
  purpose?: JobPurpose;
}
export type JobOutcome = { checked?: number; added?: number; refreshed?: number; deferred?: number };
export type ActionHandler = (action: OutboxAction) => Promise<void | JobOutcome>;

const independentQueueKinds=['webhook.deliver','planning.reminder','benchmark.run','taste.refresh','jellyfin.streams','jellyfin.updates'];
const automaticQueueKinds=[...maintenanceKinds,'jellyfin.delta','taste.refresh','social.checkin-complete','planning.reminder','webhook.deliver'];
const handlers = new Map<string, ActionHandler>();
function defaultJobPurpose(kind: string): JobPurpose {
  if(kind === 'jellyfin.bootstrap') return 'bootstrap';
  if(kind.endsWith('.scrobble') || kind === 'trakt.checkin') return 'playback';
  if(kind.endsWith('.live') || ['jellyfin.streams','jellyfin.updates','jellyfin.delta'].includes(kind)) return 'live';
  return maintenanceKinds.includes(kind) ? 'manual' : 'interactive';
}

const traversalKinds = serviceTraversalKinds.filter(kind => !kind.endsWith('.live') && !['jellyfin.streams','jellyfin.updates'].includes(kind));
// SQL fragments use only internal aliases and constant job kinds. Display and
// execution share the same urgency calculation, including completed setup work.
const sqlKinds = (kinds: readonly string[]) => `(${kinds.map(kind => `'${kind}'`).join(',')})`;
function jobPrioritySql(action: string, connection: string) {
  return `CASE WHEN ${action}.kind IN ('jellyfin.bootstrap','jellyfin.sync','trakt.import','trakt.lists-import','steam.sync') AND (${action}.kind<>'jellyfin.sync' OR NOT EXISTS(SELECT 1 FROM sync_checkpoints personal WHERE personal.connection_id=${action}.connection_id AND personal.kind='jellyfin-personal' AND personal.completed_at IS NOT NULL AND personal.scan_id IS NULL)) AND NOT EXISTS (SELECT 1 FROM sync_checkpoints checkpoint WHERE checkpoint.connection_id=${action}.connection_id AND checkpoint.kind='initial:'||${action}.kind||':'||coalesce(${action}.account_generation,${connection}.account_generation)::text AND checkpoint.completed_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM outbox_actions completed WHERE completed.connection_id=${action}.connection_id AND completed.kind=${action}.kind AND completed.account_generation IS NOT DISTINCT FROM ${action}.account_generation AND completed.state='succeeded') THEN 0 WHEN ${action}.payload->>'_jobPurpose' IN ('playback','bootstrap') THEN 0 WHEN ${action}.payload->>'_jobPurpose' IN ('interactive','manual') THEN 1 WHEN ${action}.payload->>'_jobPurpose'='live' THEN 2 WHEN ${action}.payload->>'_jobPurpose'='scheduled' THEN 3 WHEN ${action}.kind NOT IN ${sqlKinds(maintenanceKinds)} THEN 1 WHEN ${action}.kind LIKE '%.live' OR ${action}.kind='jellyfin.streams' THEN 2 ELSE 3 END`;
}
function agedPrioritySql(action: string, connection: string) {
  return `greatest(0,(${jobPrioritySql(action,connection)})-floor(extract(epoch from (now()-${action}.next_attempt_at))/30)::integer)`;
}

/** The queue and its waiting explanation must agree on account write barriers. */
function accountOrderBlockedSql(action:string,connection:string) {
  return `EXISTS(SELECT 1 FROM outbox_actions earlier LEFT JOIN provider_connections earlier_connection ON earlier_connection.id=earlier.connection_id
    WHERE earlier.user_id=${action}.user_id AND earlier.connection_id IS NOT DISTINCT FROM ${action}.connection_id
      AND earlier.kind NOT IN ${sqlKinds(independentQueueKinds)} AND earlier.kind NOT LIKE '%.live'
      AND earlier.state IN ('pending','running','failed') AND earlier.id<>${action}.id
      AND (earlier.state='running' OR (earlier.created_at,earlier.id)<(${action}.created_at,${action}.id))
      AND (coalesce((SELECT value->>'developerMode' FROM system_settings WHERE key='coast'),'false')<>'true'
        OR earlier.state='running' OR earlier.kind NOT IN ${sqlKinds(automaticQueueKinds)} OR earlier.payload->>'_manual'='true')
      AND (earlier.kind NOT IN ${sqlKinds(maintenanceKinds)} OR earlier.state='running'
        OR (${action}.kind IN ${sqlKinds(maintenanceKinds)} AND earlier.state='pending' AND earlier.next_attempt_at<=NOW()
          AND ${agedPrioritySql('earlier','earlier_connection')}<=${agedPrioritySql(action,connection)})))`;
}

/** Read models and workers share eligibility; priority never bypasses a gate. */
function pendingEligibleSql(action:string,connection:string,instance:string) {
  return `(${action}.next_attempt_at<=NOW()
    AND (coalesce((SELECT value->>'developerMode' FROM system_settings WHERE key='coast'),'false')<>'true'
      OR ${action}.kind NOT IN ${sqlKinds(automaticQueueKinds)} OR ${action}.payload->>'_manual'='true')
    AND (${instance}.settings->>'jobsRetryAt' IS NULL OR (${instance}.settings->>'jobsRetryAt')::timestamptz<=NOW())
    AND (${action}.kind IN ${sqlKinds(independentQueueKinds)} OR ${action}.kind LIKE '%.live' OR NOT ${accountOrderBlockedSql(action,connection)})
    AND (${action}.kind NOT IN ${sqlKinds(traversalKinds)} OR NOT EXISTS(SELECT 1 FROM outbox_actions active
      LEFT JOIN provider_connections active_connection ON active_connection.id=active.connection_id
      WHERE active.state='running' AND active.kind IN ${sqlKinds(traversalKinds)}
        AND coalesce(active_connection.instance_id::text,active.payload->>'instanceId')=${instance}.id::text)))`;
}

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
  purpose?: JobPurpose;
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
        await sql`SELECT a.id,a.payload,a.state FROM outbox_actions a LEFT JOIN provider_connections c ON c.id=a.connection_id
          WHERE a.kind=${input.kind} AND (
            (${jobIdentityScope(input.kind)}='account' AND a.user_id=${input.userId} AND a.connection_id IS NOT DISTINCT FROM ${input.connectionId||null}::uuid AND a.account_generation IS NOT DISTINCT FROM (SELECT account_generation FROM provider_connections WHERE id=${input.connectionId||null}::uuid) AND a.state IN ('pending','running','failed')) OR
            (${jobIdentityScope(input.kind)}='instance' AND (a.state IN ('pending','running') OR (a.state='failed' AND a.user_id=${input.userId} AND a.connection_id IS NOT DISTINCT FROM ${input.connectionId||null}::uuid AND a.account_generation IS NOT DISTINCT FROM (SELECT account_generation FROM provider_connections WHERE id=${input.connectionId||null}::uuid))) AND (
              (${input.connectionId||null}::uuid IS NOT NULL AND c.instance_id=(SELECT instance_id FROM provider_connections WHERE id=${input.connectionId||null}::uuid)) OR
              (${input.kind} in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') AND a.payload->>'instanceId'=${typeof input.payload.instanceId==='string'?input.payload.instanceId:null})
            ))
          ) LIMIT 1 FOR UPDATE OF a`;
      if (existing) {
        if(existing.state !== 'failed') {
          const purpose = promotedPurpose(readJobPurpose(existing.payload, 'scheduled'), input.purpose ?? defaultJobPurpose(input.kind));
          const stronger = input.kind === 'jellyfin.library' && input.payload.full === true && existing.payload.full !== true;
          await sql`UPDATE outbox_actions SET payload=payload||${{_manual:purpose !== 'scheduled' && purpose !== 'live',_jobPurpose:purpose,...(stronger ? existing.state === 'running' ? {_followupFull:true} : {full:true} : {})}}::jsonb WHERE id=${existing.id}`;
          updateJobRequestPriority(existing.id,purposePriority(purpose));
        }
        return existing.id;
      }
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
      VALUES (${input.userId}, ${input.connectionId || null}, ${input.kind}, ${{...input.payload,_manual:(input.purpose ?? defaultJobPurpose(input.kind)) !== 'scheduled' && (input.purpose ?? defaultJobPurpose(input.kind)) !== 'live',_jobPurpose:input.purpose ?? defaultJobPurpose(input.kind)}}::jsonb, ${input.compactionKey || null}, clock_timestamp(), ${correlationId(context.getStore())}) RETURNING id`;
    return row.id;
  });
}

/** Safe, actionable descriptions without leaking provider response bodies. */
export function jobFailureMessage(error: unknown, permanent: boolean) {
  if (classifyFailure(error) === 'timeout') return 'The service did not respond in time. Coast will retry automatically; completed import pages are retained.';
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
  if (classifyFailure(error) === 'timeout') return { code: 'provider.timeout', remedy: 'retry', retryable: true };
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
    'Jellyfin returned an unexpected library page offset.': 'jellyfin.invalid-library-offset',
    'Jellyfin library changed during pagination.': 'jellyfin.changed-library-page',
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
  const priority=sql.unsafe(jobPrioritySql('candidate','connection'));
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('queue-claim', 0))`;
    await sql`UPDATE outbox_actions SET state = 'pending', locked_at = NULL, next_attempt_at = NOW(), updated_at = NOW()
      WHERE state = 'running' AND locked_at < NOW() - INTERVAL '5 minutes'`;
    const [row] =
      await sql`UPDATE outbox_actions SET state = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT candidate.id FROM outbox_actions candidate
        LEFT JOIN provider_connections connection ON connection.id = candidate.connection_id
        LEFT JOIN provider_instances instance ON instance.id = connection.instance_id OR (candidate.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') AND candidate.kind like instance.provider||'.%' AND instance.id::text = candidate.payload->>'instanceId')
        WHERE candidate.state='pending' AND (${urgentOnly}=false OR ${priority}<3)
          AND ${sql.unsafe(pendingEligibleSql('candidate','connection','instance'))}
        ORDER BY ${sql.unsafe(agedPrioritySql('candidate','connection'))}, candidate.next_attempt_at, candidate.created_at, candidate.id FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
      ) RETURNING *, coalesce((SELECT instance_id FROM provider_connections WHERE id = connection_id), (SELECT id FROM provider_instances WHERE kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') AND kind like provider||'.%' AND id::text=payload->>'instanceId')) AS instance_id`;
    const initial = row && ['jellyfin.bootstrap','jellyfin.sync','trakt.import','trakt.lists-import','steam.sync'].includes(row.kind)
      ? (await sql`SELECT NOT EXISTS(SELECT 1 FROM outbox_actions WHERE connection_id=${row.connection_id} AND kind=${row.kind} AND account_generation IS NOT DISTINCT FROM ${row.account_generation}::uuid AND state='succeeded') AND NOT EXISTS(SELECT 1 FROM sync_checkpoints WHERE connection_id=${row.connection_id} AND kind=${'initial:'+row.kind+':'+row.account_generation} AND completed_at IS NOT NULL) AND (${row.kind}<>'jellyfin.sync' OR NOT EXISTS(SELECT 1 FROM sync_checkpoints WHERE connection_id=${row.connection_id} AND kind='jellyfin-personal' AND completed_at IS NOT NULL AND scan_id IS NULL)) AS first`)[0].first : false;
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
          purpose: initial ? 'bootstrap' : readJobPurpose(row.payload, maintenanceKinds.includes(row.kind) ? row.kind.endsWith('.live') || row.kind==='jellyfin.streams' ? 'live' : 'scheduled' : defaultJobPurpose(row.kind)),
          priority: initial ? 0 : purposePriority(readJobPurpose(row.payload, maintenanceKinds.includes(row.kind) ? row.kind.endsWith('.live') || row.kind==='jellyfin.streams' ? 'live' : 'scheduled' : defaultJobPurpose(row.kind))),
        }
      : null;
  });
}

export async function runQueueOnce(urgentOnly=false): Promise<boolean> {
  const action = await claimNextAction(urgentOnly);
  if (!action) return false;
  // Keep account writes ordered. Read-only live observations can interleave with imports.
  const reserved = await getSql().reserve();
  const lockKeys = [...(action.instanceId && serviceTraversalKinds.includes(action.kind) && !action.kind.endsWith('.live') && !['jellyfin.streams','jellyfin.updates'].includes(action.kind) ? [`queue-traversal:${action.instanceId}`] : []), independentQueueKinds.includes(action.kind)?`queue-action:${action.id}`:`queue-lane:${action.userId}:${action.connectionId ?? 'local'}${action.kind.endsWith('.live') ? ':live' : ''}`];
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
    if(action.purpose==='bootstrap')await getSql()`UPDATE outbox_actions SET payload=payload||'{"_jobPurpose":"bootstrap"}'::jsonb WHERE id=${action.id} AND state='running' AND attempts=${action.attempts}`;
    // A promotion may arrive after the claim, before this worker is registered.
    // Read its current intent so the first provider request uses that priority.
    registerJobRequestPriority(action.id, action.priority ?? 1);
    const [current]=await getSql()`SELECT payload FROM outbox_actions WHERE id=${action.id} AND state='running' AND attempts=${action.attempts}`;
    if(!current)return true;
    action.payload=current.payload;
    action.purpose=readJobPurpose(current.payload,action.purpose ?? 'interactive');
    action.priority=purposePriority(action.purpose);
    updateJobRequestPriority(action.id, action.priority);
    return await providerJob.run(action.id, () => jobExecution.run({id:action.id,attempts:action.attempts,purpose:action.purpose ?? 'interactive',started:performance.now(),checkpoints:0}, () => requestPriority.run(action.priority??1, () => context.run(action.correlationId, async () => {
      const started = performance.now();
      const startedAt=new Date();
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
            await sql`UPDATE outbox_actions SET state = 'succeeded', locked_at = NULL, last_error = NULL, payload = (payload - '_jobFailure') || ${outcome ? { _jobOutcome: outcome } : {}}::jsonb, updated_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id,payload`;
          if (completed.length && action.purpose==='bootstrap' && action.connectionId && action.accountGeneration)
            await sql`INSERT INTO sync_checkpoints(connection_id,kind,completed_at) VALUES(${action.connectionId},${'initial:'+action.kind+':'+action.accountGeneration},NOW()) ON CONFLICT(connection_id,kind) DO UPDATE SET completed_at=NOW(),updated_at=NOW()`;
          if(completed.length && completed[0].payload._followupFull === true && action.kind==='jellyfin.library') {
            await sql`INSERT INTO outbox_actions(user_id,connection_id,account_generation,kind,payload,compaction_key,created_at)
              VALUES(${action.userId},${action.connectionId},${action.accountGeneration ?? null},${action.kind},${{full:true,_manual:true,_jobPurpose:'manual'}}::jsonb,${action.kind},clock_timestamp())`;
          }
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
        if(error instanceof JobYield) {
          await getSql()`UPDATE outbox_actions SET state='pending',locked_at=NULL,attempts=greatest(0,attempts-1),next_attempt_at=NOW(),payload=payload||'{"_yielded":true}'::jsonb,updated_at=NOW()
            WHERE id=${action.id} AND state='running' AND attempts=${action.attempts}`;
          void logDiagnostic('debug','job.yield',{actionId:action.id,durationMs:performance.now()-started});
          return true;
        }
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
        const developerMode=(await getConfig()).developerMode;
        const message = developerMode?'Automatic retries are paused in developer mode. Review this failure and Retry when ready.':jobFailureMessage(error, permanent);
        const failure = jobFailureDetail(error, permanent);
        const retryAfter =
          error instanceof ProviderHttpError
            ? Math.min(86_400_000, Math.max(0, (error.retryAfterSeconds || 0) * 1000))
            : 0;
        const next = new Date(Date.now() + Math.max(retryDelayMs(action.attempts), retryAfter));
        await getSql().begin(async (sql) => {
          const failed =
            await sql`UPDATE outbox_actions SET state = ${permanent || developerMode ? 'failed' : 'pending'}, next_attempt_at = ${next}, locked_at = NULL, last_error = ${message}, payload = payload || ${{ _jobFailure: failure }}::jsonb, updated_at = NOW()
        WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id`;
          if (!failed.length) return; // A recovered lease owns the outcome now.
          if(action.kind.endsWith('.live')&&action.connectionId)await sql`UPDATE social_live_state SET work_id=NULL,remote_id=NULL,expires_at=NULL WHERE connection_id=${action.connectionId} AND account_generation=${action.accountGeneration}::uuid AND checked_at<=${startedAt}`;
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
    }))));
  } finally {
    const providerQueueWaitMs=releaseJobRequestPriority(action.id);
    if(providerQueueWaitMs)void logDiagnostic('debug','job.provider-wait',{actionId:action.id,durationMs:providerQueueWaitMs});
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
  const limits = {running: 20, pending: 100, failed: 30, succeeded: 40, cancelled: 10};
  const states = ['running','pending','failed','succeeded','cancelled'] as const;
  const recent = await Promise.all(states.map(state => {
    const limit=limits[state];
    const priority=sql.raw(agedPrioritySql('outbox_actions','provider_connections'));
    const eligibility=sql`case when ${sql.raw(pendingEligibleSql('outbox_actions','provider_connections','provider_instances'))} then 0 else 1 end`;
    return getDb().select({id:outboxActions.id}).from(outboxActions)
      .leftJoin(providerConnections,eq(providerConnections.id,outboxActions.connectionId))
      .leftJoin(providerInstances, sql`${providerInstances.id}=${providerConnections.instanceId} or (${outboxActions.kind} in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') and ${outboxActions.kind} like ${providerInstances.provider}||'.%' and ${providerInstances.id}::text=${outboxActions.payload}->>'instanceId')`)
      .where(eq(outboxActions.state,state))
      .orderBy(...(state==='pending' ? [eligibility,priority,outboxActions.nextAttemptAt,outboxActions.createdAt,outboxActions.id]
        : state==='running' ? [outboxActions.lockedAt,outboxActions.createdAt] : [desc(outboxActions.updatedAt)]))
      .limit(limit);
  }));
  const ids = recent.flat().map(row=>row.id);
  return actionDetails(ids);
}

async function actionDetails(ids: string[]) {
  if (!ids.length) return [];
  return getDb()
    .select({
      progress: sql<{
        processed?: number;
        total?: number | null;
        phase?: string;
        stageProcessed?: number; stageTotal?: number | null; startedAt?: string;
      } | null>`case when ${outboxActions.kind}='tmdb.refresh' and (${providerInstances.settings}->'metadataScan'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerInstances.settings}->'metadataScan'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerInstances.settings}->'metadataScan' when ${outboxActions.kind}='jellyfin.library' and (${providerInstances.settings}->'libraryScan'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerInstances.settings}->'libraryScan'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerInstances.settings}->'libraryScan' when ${outboxActions.kind}='jellyfin.bootstrap' and (${providerConnections.settings}->'initialSync'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerConnections.settings}->'initialSync'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerConnections.settings}->'initialSync' when ${outboxActions.kind}='jellyfin.sync' and (${providerConnections.settings}->'userSync'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerConnections.settings}->'userSync'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerConnections.settings}->'userSync'
        when ${outboxActions.kind}='steam.sync' then (select jsonb_build_object('phase','owned-games','processed',j.data->'next','total',jsonb_array_length(j.data->'items')) from provider_job_snapshots j where j.action_id=${outboxActions.id})
        when ${outboxActions.kind}='steam.achievements' and ${outboxActions.payload}->'_checkpoint'->>'task'='steam-achievements' then jsonb_build_object('phase','achievements','processed',${outboxActions.payload}->'_checkpoint'->'next','total',jsonb_array_length(${outboxActions.payload}->'_checkpoint'->'titles'))
        when ${outboxActions.kind} in ('trakt.import','trakt.lists-import') then (select jsonb_build_object('phase','trakt-'||case when t.category like 'list:%' then 'list' else t.category end||'-'||t.phase,'processed',(select count(*) from trakt_import_records r where r.stage_id=t.id and (t.phase='fetching' or r.applied)),'total',case when t.phase='fetching' then null else (select count(*) from trakt_import_records r where r.stage_id=t.id) end) from trakt_import_stages t where t.action_id=${outboxActions.id} and t.phase<>'done' order by t.updated_at desc limit 1)
        else null end`,
      purpose: sql<JobPurpose | null>`${outboxActions.payload}->>'_jobPurpose'`,
      waitingReason: sql<string | null>`case when ${outboxActions.state}<>'pending' then null
        when (${providerInstances.settings}->>'jobsRetryAt')::timestamptz>now() then 'service-cooldown'
        when ${outboxActions.nextAttemptAt}>now() then 'retry-backoff'
        when (select value->>'developerMode' from system_settings where key='coast')='true' and ${outboxActions.kind} in (${sql.join(automaticQueueKinds.map(kind=>sql`${kind}`),sql`,`)}) and coalesce(${outboxActions.payload}->>'_manual','false')<>'true' then 'paused'
        when ${providerConnections.id} is not null and (${providerConnections.status}<>'connected' or ${providerConnections.accountGeneration} is distinct from ${outboxActions.accountGeneration}) then 'connection-attention'
        when ${outboxActions.kind} not in (${sql.join(independentQueueKinds.map(kind=>sql`${kind}`),sql`,`)}) and ${outboxActions.kind} not like '%.live' and ${sql.raw(accountOrderBlockedSql('outbox_actions','provider_connections'))} then 'account-order'
        when ${outboxActions.kind} in (${sql.join(traversalKinds.map(kind=>sql`${kind}`),sql`,`)}) and exists(select 1 from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.state='running' and a.kind in (${sql.join(traversalKinds.map(kind=>sql`${kind}`),sql`,`)}) and coalesce(c.instance_id::text,a.payload->>'instanceId')=${providerInstances.id}::text and a.id<>${outboxActions.id}) then 'provider-capacity'
        when ${outboxActions.payload}->>'_yielded'='true' then 'yielded' else 'worker-capacity' end`,
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
    .leftJoin(providerInstances, sql`${providerInstances.id}=${providerConnections.instanceId} or (${outboxActions.kind} in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') and ${outboxActions.kind} like ${providerInstances.provider}||'.%' and ${providerInstances.id}::text=${outboxActions.payload}->>'instanceId')`)
    .where(inArray(outboxActions.id, ids))
    .orderBy(
      sql`case ${outboxActions.state} when 'running' then 0 when 'pending' then 1 when 'failed' then 2 else 3 end`,
      sql`case when ${outboxActions.state}='pending' then case when ${sql.raw(pendingEligibleSql('outbox_actions','provider_connections','provider_instances'))} then 0 else 1 end else null end`,
      sql`case when ${outboxActions.state}='pending' then ${sql.raw(agedPrioritySql('outbox_actions','provider_connections'))} else null end`,
      sql`case when ${outboxActions.state}='pending' then ${outboxActions.nextAttemptAt} else null end`,
      sql`case when ${outboxActions.state} in ('running','pending') then ${outboxActions.createdAt} else null end`,
      sql`case when ${outboxActions.state}<>'pending' then ${outboxActions.updatedAt} else null end desc`,outboxActions.id
    )
    .limit(ids.length);
}
/** Jobs returns one representative per active state and one last terminal run
 * per service/task. Counts cover every current-generation job, not the recent
 * individual-job sample used by diagnostics. */
export async function listTaskActions(actor: SessionUser | null) {
  requireAdmin(actor);
  const db = getSql();
  const scope = db.unsafe(taskInstanceSql('outbox_actions','provider_connections'));
  const current = db.unsafe(currentTaskGenerationSql('outbox_actions','provider_connections'));
  const [active, terminal] = await Promise.all([
    db<{id:string;count:number;instanceId:string|null}[]>`with ranked as (
      select outbox_actions.id,${scope} as "instanceId",
        count(*) over(partition by outbox_actions.kind,${scope},outbox_actions.state)::int as count,
        row_number() over(partition by outbox_actions.kind,${scope},outbox_actions.state order by
          case when outbox_actions.state='pending' then case when ${db.unsafe(pendingEligibleSql('outbox_actions','provider_connections','provider_instances'))} then 0 else 1 end end,
          case when outbox_actions.state='pending' then ${db.unsafe(agedPrioritySql('outbox_actions','provider_connections'))} end,
          case when outbox_actions.state='pending' then outbox_actions.next_attempt_at end,
          case when outbox_actions.state='running' then outbox_actions.locked_at end,
          case when outbox_actions.state='failed' then outbox_actions.updated_at end desc,
          outbox_actions.created_at,outbox_actions.id) as position
      from outbox_actions left join provider_connections on provider_connections.id=outbox_actions.connection_id
      left join provider_instances on provider_instances.id::text=${scope}
      where outbox_actions.state in ('pending','running','failed') and ${current}
    ) select id,count,"instanceId" from ranked where position=1`,
    db<{id:string;instanceId:string|null}[]>`select distinct on(outbox_actions.kind,${scope}) outbox_actions.id,${scope} as "instanceId"
      from outbox_actions left join provider_connections on provider_connections.id=outbox_actions.connection_id
      where outbox_actions.state in ('succeeded','failed','cancelled') and ${current}
      order by outbox_actions.kind,${scope},outbox_actions.updated_at desc,outbox_actions.id desc`,
  ]);
  const counts = new Map(active.map(row=>[row.id,row.count]));
  const scopes = new Map([...active,...terminal].map(row=>[row.id,row.instanceId]));
  const actions = await actionDetails([...scopes.keys()]);
  return actions.map(action=>({...action,instanceId:scopes.get(action.id)??null,taskCount:counts.get(action.id)??0}));
}
function taskInstanceSql(action:string,connection:string) {
  return `coalesce(${connection}.instance_id::text,case when ${action}.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') then ${action}.payload->>'instanceId' end)`;
}
function currentTaskGenerationSql(action:string,connection:string) {
  return `(${connection}.id is null or ${action}.account_generation is null or ${action}.account_generation=${connection}.account_generation)`;
}
/** Apply a task control to all matching current jobs, retaining each job's
 * identity, deduplication and notification handling. Running work is never
 * cancelled by this control. Expected races/conflicting work are skipped. */
export async function updateTaskActions(actor: SessionUser | null, kind: string, instanceId: string | null, action:'retry'|'cancel'|'promote') {
  requireAdmin(actor);
  const db=getSql();
  const states=action==='retry'?['failed']:action==='cancel'?['pending','failed']:['pending','running'];
  const rows=await db<{id:string}[]>`select outbox_actions.id from outbox_actions
    left join provider_connections on provider_connections.id=outbox_actions.connection_id
    where outbox_actions.kind=${kind} and ${db.unsafe(taskInstanceSql('outbox_actions','provider_connections'))} is not distinct from ${instanceId}
      and outbox_actions.state=any(${db.array(states,'TEXT')}) and ${db.unsafe(currentTaskGenerationSql('outbox_actions','provider_connections'))}
    order by outbox_actions.created_at,outbox_actions.id`;
  let updated=0,skipped=0;
  for(const row of rows){
    try{
      if(action==='cancel')await cancelAction(actor,row.id);
      else if(action==='retry')await retryAction(actor,row.id);
      else await promoteAction(actor,row.id);
      updated++;
    }catch(cause){if(cause instanceof AppError&&cause.status===409)skipped++;else throw cause;}
  }
  return {updated,skipped};
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
/** Raise an existing healthy job's urgency; never reset retry or service gates. */
export async function promoteAction(actor: SessionUser | null, id: string) {
  requireAdmin(actor);
  return getSql().begin(async sql=>{
    const [action]=await sql`select id,state,payload from outbox_actions where id=${id} for update`;
    if(!action || !['pending','running'].includes(action.state))throw new AppError(409,'This job is no longer waiting or running. Use Retry for a failed job.');
    const purpose=promotedPurpose(readJobPurpose(action.payload,'scheduled'),'manual');
    await sql`update outbox_actions set payload=payload||${{_manual:true,_jobPurpose:purpose}}::jsonb where id=${id}`;
    updateJobRequestPriority(id,purposePriority(purpose));
    return {id,state:action.state,purpose};
  });
}
export async function retryAction(actor: SessionUser | null, id: string) {
  const user = requireAdmin(actor);
  await getSql().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('provider-maintenance',0))`;
    const [action]=await sql`select a.*,coalesce(c.instance_id::text,a.payload->>'instanceId') as instance from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id=${id}`;
    if(!action)throw new AppError(409,'This action cannot be retried.');
    if(action.kind==='benchmark.run')throw new AppError(409,'Run a new benchmark in Benchmarking settings to preserve the recorded result.');
    if(maintenanceKinds.includes(action.kind)&&action.instance){
      const [busy]=await sql`select a.id from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.id<>${id} and a.kind=${action.kind} and a.state in ('pending','running') and (${jobIdentityScope(action.kind)}='instance' and coalesce(c.instance_id::text,a.payload->>'instanceId')=${action.instance} or ${jobIdentityScope(action.kind)}='account' and a.connection_id is not distinct from ${action.connection_id}::uuid and a.user_id=${action.user_id} and a.account_generation is not distinct from ${action.account_generation}::uuid) limit 1`;
      if(busy)throw new AppError(409,'This task is already queued or running for this service.');
    }
    const [row]=await sql`UPDATE outbox_actions SET state='pending',payload=payload||'{"_manual":true,"_jobPurpose":"manual"}'::jsonb,next_attempt_at=NOW(),updated_at=NOW() WHERE id=${id} AND (user_id=${user.id} OR ${user.role==='admin'}) AND state IN ('pending','failed') RETURNING id`;
    if(!row)throw new AppError(409,'This action cannot be retried.');
  });
}
