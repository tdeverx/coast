import { taskInstanceSql, currentTaskGenerationSql } from './task-controls.server';
export {cancelAction,retryAction,promoteAction} from './task-controls.server';
export {updateTaskActions} from './task-commands.server';
import type { ProviderActionError } from '#lib/providers/contracts.js';
import { dependencyScopeSql, queueOrderCteSql } from './dependencies';
import { maintenanceKinds, serviceTraversalKinds } from '#lib/providers/tasks.js';
import { taskRetryAttentionAttempts, jobIdentityScope, purposePriority, readJobPurpose, promotedPurpose, type JobPurpose } from '#lib/providers/job-policy.js';
import { jobExecution, JobYield } from './execution';
import { requestPriority, providerJob, registerJobRequestPriority, updateJobRequestPriority, releaseJobRequestPriority, ProviderQueueBusyError, type RequestPriority } from '../security/request-priority';
import { context, logDiagnostic, classifyFailure } from '../diagnostics';
import { runtimeEvidence } from '../diagnostics/runtime';
import { refreshDiagnosticConfig,getConfig } from '../config';
import { correlationId } from '../../diagnostics';
import { eq, sql, inArray } from 'drizzle-orm';
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
export type JobOutcome = { checked?: number; added?: number; refreshed?: number; deferred?: number; applied?:number;review?:number;skipped?:number };
export type ActionHandler = (action: OutboxAction) => Promise<void | JobOutcome>;

const independentQueueKinds=['feature.reconcile','webhook.deliver','planning.reminder','benchmark.run','taste.refresh','jellyfin.streams','jellyfin.updates'];
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

/** Running work keeps the account lane exclusive. Unsent mutations order only
 * overlapping effects; observations can pass an unrelated blocked mutation. */
function accountOrderBlockerSql(action:string) {
  const requested=dependencyScopeSql(action), previous=dependencyScopeSql('earlier');
  const common=`earlier.user_id=${action}.user_id and earlier.id<>${action}.id
    and earlier.kind not in ${sqlKinds(independentQueueKinds)} and earlier.kind not like '%.live'
    and earlier.state in ('pending','running','failed')
    and (earlier.account_generation is null or earlier.connection_id is null or earlier.account_generation=(select account_generation from provider_connections where id=earlier.connection_id))
    and (earlier.state='running' or (
      (earlier.created_at,earlier.id)<(${action}.created_at,${action}.id)
      and (${requested}) is not null and (${previous}) is not null
      and ((${requested})='*' or (${previous})='*' or (${requested})=(${previous}))
      and (coalesce((select value->>'developerMode' from system_settings where key='coast'),'false')<>'true'
        or earlier.kind not in ${sqlKinds(automaticQueueKinds)} or earlier.payload->>'_manual'='true'))) `;
  // Separate NULL/local lanes so PostgreSQL can use both leading columns of the
  // existing account-order index instead of scanning every job for this user.
  return `case when ${action}.connection_id is null then (select earlier.id from outbox_actions earlier
    where earlier.connection_id is null and ${common} order by earlier.created_at,earlier.id limit 1) else (select earlier.id from outbox_actions earlier
    where earlier.connection_id=${action}.connection_id and ${common} order by earlier.created_at,earlier.id limit 1) end`;
}

function accountOrderBlockedSql(action:string,_connection:string,cached=true) {
  return cached?`${action}.id in (select id from queue_blockers where blocking_id is not null)`:`(${accountOrderBlockerSql(action)}) is not null`;
}

function featureTransitionBlockedSql(action:string) {
  return `(${action}.kind in ('webhook.deliver','planning.reminder','jellyfin.sync','catalogue.user-scan','tmdb.refresh','trakt.import','trakt.lists-import','trakt.export','trakt.list-export','trakt.progress','trakt.collection-project','trakt.collection-review','jellyfin.live','steam.live','trakt.live','trakt.scrobble','trakt.checkin','social.checkin-complete','seerr.request','seerr.sync','steam.sync','steam.achievements','igdb.steam-metadata','trakt.recommendations','tmdb.recommendations','igdb.recommendations','taste.refresh') and exists(
    select 1 from outbox_actions transition where transition.kind='feature.reconcile' and transition.state in ('pending','running','failed')
      and (transition.payload->>'subjectId' is null or transition.payload->>'subjectId'=${action}.user_id::text)
      and ${action}.created_at<=(transition.payload->>'cutoff')::timestamptz))`;
}

/** Read models and workers share eligibility; priority never bypasses a gate. */
function pendingEligibleSql(action:string,connection:string,instance:string,cached=true) {
  return `(${action}.next_attempt_at<=NOW()
    AND NOT ${featureTransitionBlockedSql(action)}
    AND (coalesce((SELECT value->>'developerMode' FROM system_settings WHERE key='coast'),'false')<>'true'
      OR ${action}.kind NOT IN ${sqlKinds(automaticQueueKinds)} OR ${action}.payload->>'_manual'='true')
    AND (${instance}.settings->>'jobsRetryAt' IS NULL OR (${instance}.settings->>'jobsRetryAt')::timestamptz<=NOW())
    AND (${action}.kind IN ${sqlKinds(independentQueueKinds)} OR ${action}.kind LIKE '%.live' OR NOT ${accountOrderBlockedSql(action,connection,cached)})
    AND (${action}.kind NOT IN ${sqlKinds(traversalKinds)} OR NOT EXISTS(SELECT 1 FROM outbox_actions active
      LEFT JOIN provider_connections active_connection ON active_connection.id=active.connection_id
      WHERE active.state='running' AND active.kind IN ${sqlKinds(traversalKinds)}
        AND coalesce(active_connection.instance_id::text,active.payload->>'instanceId')=${instance}.id::text)))`;
}

/** The worker and actual-data verification use the same complete candidate
 * selection. Read-only probes omit only row locks and the outer claim update. */
export function queueSelectionSql(urgentOnly=false,lock=false) {
  return `${queueOrderCteSql(independentQueueKinds,automaticQueueKinds)}
    select candidate.id from outbox_actions candidate
    left join provider_connections connection on connection.id=candidate.connection_id
    left join provider_instances instance on instance.id=connection.instance_id or
      (candidate.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') and candidate.kind like instance.provider||'.%' and instance.id::text=candidate.payload->>'instanceId')
    where candidate.state='pending' and (${!urgentOnly} or ${jobPrioritySql('candidate','connection')}<3)
      and ${pendingEligibleSql('candidate','connection','instance')}
    order by ${agedPrioritySql('candidate','connection')},candidate.next_attempt_at,candidate.created_at,candidate.id
    ${lock?'for update of candidate skip locked':''} limit 1`;
}

export class PermanentActionError extends Error {
  constructor(message: string, public reason?: ProviderActionError['code']) {
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
    const [admission]=await sql`select coast_job_allowed(${input.userId}::uuid,${input.kind},${input.payload}::jsonb) as allowed`;
    if(!admission.allowed)throw new AppError(403,'This task is disabled by feature settings.','feature_disabled');
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
  if (safeDiagnosticErrorCode(error) === 'local.database-deadlock') return 'Concurrent database work conflicted. Coast will retry automatically; committed work is retained.';
  if (error instanceof ProviderQueueBusyError) return 'Coast is busy contacting connected services. This job will retry automatically.';
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

export type JobFailure = { stage?:string; validation?:{path:string;expected:string;receivedType:string}[]; code: string; remedy: 'connection' | 'permissions' | 'metadata' | 'retry'; retryable: boolean };
export function jobFailureDetail(error: unknown, permanent: boolean): JobFailure {
  if(error instanceof PermanentActionError && error.reason){
    if(error.reason==='permission')return {code:'provider.permission',remedy:'permissions',retryable:false};
    if(error.reason==='identity')return {code:'provider.identity',remedy:'connection',retryable:false};
    return {code:'action.rejected',remedy:'metadata',retryable:false};
  }
  if (error instanceof ProviderQueueBusyError) return {code:'local.provider-busy',remedy:'retry',retryable:true};
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

// Valibot represents record keys as object path segments too. Syntax alone
// cannot prove a key is a schema field: retain only these public field names.
const diagnosticFieldNames=new Set(['Items','TotalRecordCount','StartIndex','Id','Name','Type','UserData','Played','PlayCount',
  'PlaybackPositionTicks','RunTimeTicks','DateCreated','PremiereDate','ProviderIds','SortName','IndexNumber','ParentIndexNumber',
  'SeriesId','SeasonId','ParentId','CollectionType','Artists','Album','AlbumId','ArtistItems','ImageTags','MediaSources','MediaStreams',
  'Container','Size','Height','Width','UserId','results','page','totalResults','totalPages','id','type','status','media','mediaType',
  'tmdbId','tvdbId','seasons','seasonNumber','episodes','episodeNumber','user','permissions','name','ids','title','year',
  'rating','progress','watched_at','collected_at','listed_at','rated_at','plays','appid','playtime_forever','achievements']);
/** Include only schema paths and value types; never persist rejected provider values. */
export function validationDiagnostic(error: unknown) {
  if (!(error instanceof v.ValiError)) return undefined;
  return error.issues.slice(0, 12).map(issue => ({
    path: issue.path?.slice(0,12).map((segment:{type:string;key:unknown}) =>
      segment.type==='array' && typeof segment.key==='number' && segment.key>=0 && segment.key<=1000000 ? String(segment.key)
        : segment.type==='object' && typeof segment.key==='string' && diagnosticFieldNames.has(segment.key) ? segment.key : '*').join('.') || '(root)',
    expected: ['string','number','boolean','object','array','null','undefined'].includes(issue.expected) ? issue.expected : 'schema',
    receivedType: issue.input===null?'null':Array.isArray(issue.input)?'array':typeof issue.input,
  }));
}

/** Map known scan invariants to stable codes without exposing arbitrary error messages. */
export function safeDiagnosticErrorCode(error: unknown) {
  // Drizzle wraps the Bun PostgreSQL error as its cause. Inspect only the fixed
  // SQLSTATE, never SQL text/parameters or arbitrary exception messages.
  let cause=error;
  for(let depth=0;depth<5&&cause instanceof Error;depth++){
    if('code' in cause&&cause.code==='40P01'||'errno' in cause&&cause.errno==='40P01')return 'local.database-deadlock';
    cause=cause.cause;
  }
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

  const database=getSql();
  return database.begin(async (sql) => {
  // These are lazy SQL fragments, not standalone transaction queries. Bun
  // registers tx.unsafe() in its pending set and rejects the unawaited fragment
  // on disconnect, even when the containing query/transaction is caught.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('queue-claim', 0))`;
    await sql`UPDATE outbox_actions SET state = 'pending', locked_at = NULL, next_attempt_at = NOW(), updated_at = NOW()
      WHERE state = 'running' AND locked_at < NOW() - INTERVAL '5 minutes'`;
    await sql`update outbox_actions set state='cancelled',last_error='Disabled in feature settings.',updated_at=now() where id in (select id from outbox_actions where state in ('pending','failed') and not coast_job_allowed(user_id,kind,payload) order by id limit 100 for update skip locked)`;
    const [row] =
      await sql`UPDATE outbox_actions SET state = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
        WHERE id = (${database.unsafe(queueSelectionSql(urgentOnly,true))}) RETURNING *, coalesce((SELECT instance_id FROM provider_connections WHERE id = connection_id), (SELECT id FROM provider_instances WHERE kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') AND kind like provider||'.%' AND id::text=payload->>'instanceId')) AS instance_id`;
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
  const reserved = await runtimeEvidence.track('reserve', () => getSql().reserve());
  const releaseEvidence = runtimeEvidence.begin('reservation');
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
    return await providerJob.run(action.id, () => jobExecution.run({id:action.id,userId:action.userId,kind:action.kind,payload:action.payload,attempts:action.attempts,purpose:action.purpose ?? 'interactive',started:performance.now(),checkpoints:0}, () => requestPriority.run(action.priority??1, () => context.run(action.correlationId, async () => {
      const started = performance.now();
      const startedAt=new Date();
      void logDiagnostic('debug', 'job.start', { actionId: action.id, attempts: action.attempts });
      const heartbeat = setInterval(() => {
        void runtimeEvidence.track('heartbeat', () => reserved`UPDATE outbox_actions SET locked_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts}`).catch(
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
        const [admission]=await getSql()`select coast_job_allowed(${action.userId}::uuid,${action.kind},${action.payload}::jsonb) as allowed`;
        if(!admission.allowed)throw new PermanentActionError('This task is disabled by feature settings.');
        const handler = handlers.get(action.kind);
        if (!handler) throw new PermanentActionError('This action type is no longer supported.');
        const outcome = await handler(action);
        await getSql().begin(async (sql) => {
          const completed =
            await sql`UPDATE outbox_actions SET state = 'succeeded', locked_at = NULL, last_error = NULL, payload = (payload - '_jobFailure') || ${outcome ? { _jobOutcome: outcome } : {}}::jsonb, updated_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id,payload`;
          if (completed.length && action.purpose==='bootstrap' && action.connectionId && action.accountGeneration)
            await sql`INSERT INTO sync_checkpoints(connection_id,kind,completed_at) VALUES(${action.connectionId},${'initial:'+action.kind+':'+action.accountGeneration},NOW()) ON CONFLICT(connection_id,kind) DO UPDATE SET completed_at=NOW(),updated_at=NOW()`;
          if (completed.length && completed[0].payload._followupFull === true &&
              (action.kind === 'jellyfin.library' || action.kind === 'jellyfin.sync')) {
            const payload = {
              ...(action.kind === 'jellyfin.library' ? { full: true } : {}),
              _manual: true,
              _jobPurpose: 'manual',
            };
            await sql`INSERT INTO outbox_actions(user_id,connection_id,account_generation,kind,payload,compaction_key,created_at)
              SELECT ${action.userId},c.id,c.account_generation,${action.kind},${payload}::jsonb,${action.kind},clock_timestamp()
              FROM provider_connections c WHERE c.id=${action.connectionId} AND c.account_generation=${action.accountGeneration ?? null}::uuid
                AND (${action.kind}='jellyfin.library' OR
                  c.settings->'userSync'->>'resetId' IS DISTINCT FROM c.settings->>'userSyncResetId')
                AND NOT EXISTS(SELECT 1 FROM outbox_actions a WHERE a.connection_id=c.id
                  AND a.account_generation=c.account_generation AND a.kind=${action.kind} AND a.state IN ('pending','running'))`;
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
        const failure:JobFailure = {...jobFailureDetail(error, permanent),stage:safeDiagnosticStage(error),validation:validationDiagnostic(error)};
        const retryAfter =
          error instanceof ProviderHttpError
            ? Math.min(86_400_000, Math.max(0, (error.retryAfterSeconds || 0) * 1000))
            : 0;
        const next = new Date(Date.now() + Math.max(retryDelayMs(action.attempts), retryAfter));
        // A refused local admission never attempted HTTP delivery. Keep the
        // claim generation monotonic while preserving the webhook's retry budget.
        const base=action.payload._webhookAttemptBase;
        const capacityCredit=error instanceof ProviderQueueBusyError && action.kind==='webhook.deliver'
          ? {_webhookAttemptBase:(typeof base==='number'&&Number.isInteger(base)&&base>=0&&base<action.attempts?base:0)+1}:{};
        await getSql().begin(async (sql) => {
          const failed =
            await sql`UPDATE outbox_actions SET state = ${permanent || developerMode ? 'failed' : 'pending'}, next_attempt_at = ${next}, locked_at = NULL, last_error = ${message}, payload = payload || ${{ _jobFailure: failure,...capacityCredit }}::jsonb, updated_at = NOW()
        WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id`;
          if (!failed.length) return; // A recovered lease owns the outcome now.
          if(!(error instanceof ProviderQueueBusyError)&&action.kind.endsWith('.live')&&action.connectionId)await sql`UPDATE social_live_state SET work_id=NULL,remote_id=NULL,expires_at=NULL WHERE connection_id=${action.connectionId} AND account_generation=${action.accountGeneration}::uuid AND checked_at<=${startedAt}`;
          if (
            action.instanceId &&
            retryAfter > 0 &&
            error instanceof ProviderHttpError &&
            [429, 503].includes(error.status)
          ) {
            const until = new Date(Date.now() + retryAfter).toISOString();
            await sql`UPDATE provider_instances SET settings = jsonb_set(settings, '{jobsRetryAt}', to_jsonb(GREATEST(COALESCE(settings->>'jobsRetryAt', ''), ${until})::text), true) WHERE id = ${action.instanceId}`;
          }
          if (permanent || action.attempts >= taskRetryAttentionAttempts)
            await notify(
              {
                userId: action.userId,
                kind: 'external-action',
                title: error instanceof ProviderQueueBusyError ? 'Waiting for Coast capacity' : permanent
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
      try { reserved.release(); } finally { releaseEvidence(); }
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
      worked = await runtimeEvidence.track('queue', () => runQueueOnce(urgentOnly));
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
  const db=getSql();
  const recent = await Promise.all(states.map(state => {
    const order=state==='pending'?`case when ${pendingEligibleSql('outbox_actions','provider_connections','provider_instances')} then 0 else 1 end,${agedPrioritySql('outbox_actions','provider_connections')},outbox_actions.next_attempt_at,outbox_actions.created_at,outbox_actions.id`
      :state==='running'?'outbox_actions.locked_at,outbox_actions.created_at':'outbox_actions.updated_at desc';
    return db<{id:string}[]>`${db.unsafe(queueOrderCteSql(independentQueueKinds,automaticQueueKinds))}
      select outbox_actions.id from outbox_actions
      left join provider_connections on provider_connections.id=outbox_actions.connection_id
      left join provider_instances on provider_instances.id=provider_connections.instance_id or (outbox_actions.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') and outbox_actions.kind like provider_instances.provider||'.%' and provider_instances.id::text=outbox_actions.payload->>'instanceId')
      where outbox_actions.state=${state} order by ${db.unsafe(order)} limit ${limits[state]}`;
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
      } | null>`case when ${outboxActions.kind} in ('jellyfin.sync','jellyfin.library') and ${outboxActions.payload}->'_checkpoint'->>'task'='jellyfin-reading-access' and ${outboxActions.payload}->'_checkpoint'->>'done'='false' then jsonb_build_object('phase','reading','processed',${outboxActions.payload}->'_checkpoint'->'offset','total',${outboxActions.payload}->'_checkpoint'->'total') when ${outboxActions.kind}='tmdb.refresh' and (${providerInstances.settings}->'metadataScan'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerInstances.settings}->'metadataScan'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerInstances.settings}->'metadataScan' when ${outboxActions.kind}='jellyfin.library' and (${providerInstances.settings}->'libraryScan'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerInstances.settings}->'libraryScan'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerInstances.settings}->'libraryScan' when ${outboxActions.kind}='jellyfin.bootstrap' and (${providerConnections.settings}->'initialSync'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerConnections.settings}->'initialSync'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerConnections.settings}->'initialSync' when ${outboxActions.kind}='jellyfin.sync' and (${providerConnections.settings}->'userSync'->>'startedAt')::timestamptz >= ${outboxActions.createdAt} and (${outboxActions.state} in ('pending','running') or (${providerConnections.settings}->'userSync'->>'startedAt')::timestamptz <= ${outboxActions.updatedAt}) then ${providerConnections.settings}->'userSync'
        when ${outboxActions.kind}='steam.sync' then (select jsonb_build_object('phase','owned-games','processed',j.data->'next','total',jsonb_array_length(j.data->'items')) from provider_job_snapshots j where j.action_id=${outboxActions.id})
        when ${outboxActions.kind}='steam.achievements' and ${outboxActions.payload}->'_checkpoint'->>'task'='steam-achievements' then jsonb_build_object('phase','achievements','processed',${outboxActions.payload}->'_checkpoint'->'next','total',jsonb_array_length(${outboxActions.payload}->'_checkpoint'->'titles'))
        when ${outboxActions.kind} in ('trakt.import','trakt.lists-import') then (select jsonb_build_object('phase','trakt-'||case when t.category like 'list:%' then 'list' else t.category end||'-'||t.phase,'processed',(select count(*) from trakt_import_records r where r.stage_id=t.id and (t.phase='fetching' or r.applied)),'total',case when t.phase='fetching' then null else (select count(*) from trakt_import_records r where r.stage_id=t.id) end) from trakt_import_stages t where t.action_id=${outboxActions.id} and t.phase<>'done' order by t.updated_at desc limit 1)
        else null end`,
      purpose: sql<JobPurpose | null>`${outboxActions.payload}->>'_jobPurpose'`,
      waitingReason: sql<string | null>`case when ${outboxActions.state}<>'pending' then null
        when (${providerInstances.settings}->>'jobsRetryAt')::timestamptz>now() then 'service-cooldown'
        when ${outboxActions.nextAttemptAt}>now() then 'retry-backoff'
        when (select value->>'developerMode' from system_settings where key='coast')='true' and ${outboxActions.kind} in (${sql.join(automaticQueueKinds.map(kind=>sql`${kind}`),sql`,`)}) and coalesce(${outboxActions.payload}->>'_manual','false')<>'true' then 'paused'
        when ${sql.raw(featureTransitionBlockedSql('outbox_actions'))} then 'feature-transition'
        when ${providerConnections.id} is not null and (${providerConnections.status}<>'connected' or (${outboxActions.accountGeneration} is not null and ${providerConnections.accountGeneration} is distinct from ${outboxActions.accountGeneration})) then 'connection-attention'
        when ${outboxActions.kind} not in (${sql.join(independentQueueKinds.map(kind=>sql`${kind}`),sql`,`)}) and ${outboxActions.kind} not like '%.live' and ${sql.raw(accountOrderBlockedSql('outbox_actions','provider_connections',false))} then 'account-order'
        when ${outboxActions.kind} in (${sql.join(traversalKinds.map(kind=>sql`${kind}`),sql`,`)}) and exists(select 1 from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.state='running' and a.kind in (${sql.join(traversalKinds.map(kind=>sql`${kind}`),sql`,`)}) and coalesce(c.instance_id::text,a.payload->>'instanceId')=${providerInstances.id}::text and a.id<>${outboxActions.id}) then 'provider-capacity'
        when ${outboxActions.payload}->>'_yielded'='true' then 'yielded' else 'worker-capacity' end`,
      blockingAction:sql<{id:string;kind:string;state:string}|null>`case when ${outboxActions.state}='pending' and ${outboxActions.kind} not in (${sql.join(independentQueueKinds.map(kind=>sql`${kind}`),sql`,`)}) and ${outboxActions.kind} not like '%.live' then (select jsonb_build_object('id',b.id,'kind',b.kind,'state',b.state) from outbox_actions b where b.id=(${sql.raw(accountOrderBlockerSql('outbox_actions'))})) else null end`,
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
      sql`case when ${outboxActions.state}='pending' then case when ${sql.raw(pendingEligibleSql('outbox_actions','provider_connections','provider_instances',false))} then 0 else 1 end else null end`,
      sql`case when ${outboxActions.state}='pending' then ${sql.raw(agedPrioritySql('outbox_actions','provider_connections'))} else null end`,
      sql`case when ${outboxActions.state}='pending' then ${outboxActions.nextAttemptAt} else null end`,
      sql`case when ${outboxActions.state} in ('running','pending') then ${outboxActions.createdAt} else null end`,
      sql`case when ${outboxActions.state}<>'pending' then ${outboxActions.updatedAt} else null end desc`,outboxActions.id
    )
    .limit(ids.length);
}
function jobAttentionSql(action:string){
  return `(${action}.state='failed' or (${action}.state='pending' and ${action}.attempts>=${taskRetryAttentionAttempts}
    and jsonb_typeof(${action}.payload->'_jobFailure')='object'
    and coalesce(${action}.payload->'_jobFailure'->>'code','')<>'local.provider-busy'))`;
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
    db<{id:string;count:number;attentionCount:number;instanceId:string|null}[]>`${db.unsafe(queueOrderCteSql(independentQueueKinds,automaticQueueKinds))}, ranked as (
      select outbox_actions.id,${scope} as "instanceId",
        count(*) over(partition by outbox_actions.kind,${scope},outbox_actions.state)::int as count,
        count(*) filter(where ${db.unsafe(jobAttentionSql('outbox_actions'))}) over(partition by outbox_actions.kind,${scope},outbox_actions.state)::int as "attentionCount",
        row_number() over(partition by outbox_actions.kind,${scope},outbox_actions.state order by
          case when ${db.unsafe(jobAttentionSql('outbox_actions'))} then 0 else 1 end,
          case when outbox_actions.state='pending' then case when ${db.unsafe(pendingEligibleSql('outbox_actions','provider_connections','provider_instances'))} then 0 else 1 end end,
          case when outbox_actions.state='pending' then ${db.unsafe(agedPrioritySql('outbox_actions','provider_connections'))} end,
          case when outbox_actions.state='pending' then outbox_actions.next_attempt_at end,
          case when outbox_actions.state='running' then outbox_actions.locked_at end,
          case when outbox_actions.state='failed' then outbox_actions.updated_at end desc,
          outbox_actions.created_at,outbox_actions.id) as position
      from outbox_actions left join provider_connections on provider_connections.id=outbox_actions.connection_id
      left join provider_instances on provider_instances.id::text=${scope}
      where outbox_actions.state in ('pending','running','failed') and ${current}
    ) select id,count,"attentionCount","instanceId" from ranked where position=1`,
    db<{id:string;instanceId:string|null}[]>`select distinct on(outbox_actions.kind,${scope}) outbox_actions.id,${scope} as "instanceId"
      from outbox_actions left join provider_connections on provider_connections.id=outbox_actions.connection_id
      where outbox_actions.state in ('succeeded','failed','cancelled') and ${current}
      order by outbox_actions.kind,${scope},outbox_actions.updated_at desc,outbox_actions.id desc`,
  ]);
  const counts = new Map(active.map(row=>[row.id,row.count]));
  const attentionCounts=new Map(active.map(row=>[row.id,row.attentionCount]));
  const scopes = new Map([...active,...terminal].map(row=>[row.id,row.instanceId]));
  const actions = await actionDetails([...scopes.keys()]);
  return actions.map(action=>({...action,instanceId:scopes.get(action.id)??null,taskCount:counts.get(action.id)??0,attentionCount:attentionCounts.get(action.id)??0}));
}
