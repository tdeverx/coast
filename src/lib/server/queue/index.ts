import { context, logDiagnostic, classifyFailure } from '../diagnostics';
import { refreshDiagnosticConfig } from '../config';
import { correlationId } from '../../diagnostics';
import { desc, eq, sql } from 'drizzle-orm';
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
  attempts: number;
  correlationId: string;
}
export type ActionHandler = (action: OutboxAction) => Promise<void>;
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
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.connectionId || 'local'}`}, 0))`;
    if (input.connectionId) {
      const [connection] =
        await sql`SELECT id FROM provider_connections WHERE id = ${input.connectionId} AND user_id = ${input.userId}`;
      if (!connection) throw new AppError(403, 'This connection does not belong to this account.');
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

export async function claimNextAction(): Promise<OutboxAction | null> {
  // A crashed worker's lease becomes retryable, preserving its position in the connection lane.
  await getSql()`UPDATE outbox_actions SET state = 'pending', locked_at = NULL, next_attempt_at = NOW(), updated_at = NOW()
    WHERE state = 'running' AND locked_at < NOW() - INTERVAL '5 minutes'`;
  const [row] =
    await getSql()`UPDATE outbox_actions SET state = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT candidate.id FROM outbox_actions candidate
      WHERE candidate.state = 'pending' AND candidate.next_attempt_at <= NOW()
        AND NOT EXISTS (SELECT 1 FROM outbox_actions earlier
          WHERE earlier.user_id = candidate.user_id AND earlier.connection_id IS NOT DISTINCT FROM candidate.connection_id
          AND earlier.state IN ('pending', 'running', 'failed') AND (earlier.created_at, earlier.id) < (candidate.created_at, candidate.id))
      ORDER BY candidate.created_at, candidate.id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`;
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        connectionId: row.connection_id,
        kind: row.kind,
        payload: row.payload,
        attempts: row.attempts,
        correlationId: row.correlation_id,
      }
    : null;
}

export async function runQueueOnce(): Promise<boolean> {
  const action = await claimNextAction();
  if (!action) return false;
  await refreshDiagnosticConfig();
  return context.run(action.correlationId, async () => {
    const started = performance.now();
    void logDiagnostic('debug', 'job.start', { actionId: action.id, attempts: action.attempts });
    const heartbeat = setInterval(() => {
      void getSql()`UPDATE outbox_actions SET locked_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts}`.catch(
        () => {}
      );
    }, 20_000);
    heartbeat.unref();
    try {
      const handler = handlers.get(action.kind);
      if (!handler) throw new PermanentActionError('This action type is no longer supported.');
      await handler(action);
      await getSql().begin(async (sql) => {
        const completed =
          await sql`UPDATE outbox_actions SET state = 'succeeded', locked_at = NULL, last_error = NULL, updated_at = NOW() WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id`;
        if (completed.length) await resolveNotification(action.userId, `outbox:${action.id}`, sql);
      });
      void logDiagnostic('info', 'job.complete', {
        actionId: action.id,
        attempts: action.attempts,
        durationMs: performance.now() - started,
      });
    } catch (error) {
      void logDiagnostic('error', 'job.failed', {
        actionId: action.id,
        attempts: action.attempts,
        failure: classifyFailure(error),
        status: error instanceof ProviderHttpError ? error.status : undefined,
        errorCode: safeDiagnosticErrorCode(error),
        stage: safeDiagnosticStage(error),
        durationMs: performance.now() - started,
      });
      const permanent =
        error instanceof PermanentActionError ||
        (error instanceof ProviderHttpError &&
          [400, 401, 403, 404, 405, 409, 410, 422].includes(error.status));
      const message = permanent
        ? 'The connected service could not accept this action. An administrator can review the connection and retry it.'
        : 'The connected service is unavailable. Coast will retry automatically.';
      const retryAfter =
        error instanceof ProviderHttpError
          ? Math.min(86_400_000, Math.max(0, (error.retryAfterSeconds || 0) * 1000))
          : 0;
      const next = new Date(Date.now() + Math.max(retryDelayMs(action.attempts), retryAfter));
      await getSql().begin(async (sql) => {
        const failed =
          await sql`UPDATE outbox_actions SET state = ${permanent ? 'failed' : 'pending'}, next_attempt_at = ${next}, locked_at = NULL, last_error = ${message}, updated_at = NOW()
        WHERE id = ${action.id} AND state = 'running' AND attempts = ${action.attempts} RETURNING id`;
        if (!failed.length) return; // A recovered lease owns the outcome now.
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
            },
            sql
          );
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  });
}

let running = false;
let workerGeneration = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();
/** A small worker pool lets unrelated connections progress while one service scans a library. */
export function startQueueWorker() {
  if (running) return;
  running = true;
  const generation = ++workerGeneration;
  const schedule = (delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      void tick();
    }, delay);
    timers.add(timer);
    timer.unref();
  };
  const tick = async () => {
    if (!running || generation !== workerGeneration) return;
    let worked = false;
    try {
      worked = await runQueueOnce();
    } catch {
      /* Retain work during database outages. */
    }
    if (running && generation === workerGeneration) schedule(worked ? 20 : 2000);
  };
  for (let worker = 0; worker < 3; worker++) schedule(worker * 50);
}
export function stopQueueWorker() {
  running = false;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

export async function listActions(actor: SessionUser | null) {
  requireAdmin(actor);
  return getDb()
    .select({
      connectionLabel: sql<string>`concat(coalesce(${providerInstances.name},'Coast'), ' · ', ${users.username})`,
      id: outboxActions.id,
      userId: outboxActions.userId,
      connectionId: outboxActions.connectionId,
      kind: outboxActions.kind,
      state: outboxActions.state,
      attempts: outboxActions.attempts,
      lastError: outboxActions.lastError,
      nextAttemptAt: outboxActions.nextAttemptAt,
      createdAt: outboxActions.createdAt,
    })
    .from(outboxActions)
    .innerJoin(users, eq(users.id, outboxActions.userId))
    .leftJoin(providerConnections, eq(providerConnections.id, outboxActions.connectionId))
    .leftJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
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
  const [row] =
    await getSql()`UPDATE outbox_actions SET state = 'pending', next_attempt_at = NOW(), updated_at = NOW() WHERE id = ${id} AND (user_id = ${user.id} OR ${user.role === 'admin'}) AND state IN ('pending', 'failed') RETURNING id`;
  if (!row) throw new AppError(409, 'This action cannot be retried.');
}
