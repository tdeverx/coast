import { AsyncLocalStorage } from 'node:async_hooks';
import { getSql, type Database } from '../db';
import { outboxActions } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { purposePriority, readJobPurpose, type JobPurpose } from '$lib/providers/job-policy';
import { updateJobRequestPriority } from '../security/request-priority';

type Execution = { userId?: string; kind?: string; payload?: Record<string,unknown>; id: string; attempts: number; purpose: JobPurpose; started: number; checkpoints: number };
export const jobExecution = new AsyncLocalStorage<Execution>();
/** Control flow, never a provider failure or a retry attempt. */
export class JobYield extends Error {
  constructor() { super('Job yielded at a committed checkpoint.'); this.name = 'JobYield'; }
}

/** Fence writes in their committing transaction, after the existing connection
 * or account lock so reconnect/reset retains the same lock order. */
export async function assertJobLease(store:Pick<Database,'select'>|Pick<ReturnType<typeof getSql>,'unsafe'>, lock=false) {
  const execution=jobExecution.getStore();
  if(!execution)return;
  if('unsafe' in store){
    if(execution.userId&&execution.kind){
      const [policy]=await store.unsafe('select coast_job_allowed($1::uuid,$2,$3::jsonb) as allowed',
        [execution.userId,execution.kind,JSON.stringify(execution.payload??{})]);
      if(!policy.allowed)throw new JobYield();
    }
    const [lease]=await store.unsafe(`select id from outbox_actions where id=$1::uuid and state='running' and attempts=$2${lock?' for update':''}`,
      [execution.id,execution.attempts]);
    if(!lease)throw new JobYield();
    return;
  }
  const query=store.select({id:outboxActions.id}).from(outboxActions).where(and(
    eq(outboxActions.id,execution.id),eq(outboxActions.state,'running'),eq(outboxActions.attempts,execution.attempts)));
  if(execution.userId&&execution.kind){
    const database=store as Pick<Database,'select'|'execute'>;
    const [policy]=await database.execute<{allowed:boolean}>(sql`select coast_job_allowed(${execution.userId}::uuid,${execution.kind},${execution.payload??{}}::jsonb) as allowed`);
    if(!policy.allowed)throw new JobYield();
  }
  const [lease]=await (lock?query.for('update'):query);
  if(!lease)throw new JobYield();
}

/** Call only after a replay-safe page/stage has been committed. Direct callers
 * finish normally; queue workers release their lane after a bounded chunk. */
export async function jobCheckpoint() {
  const execution = jobExecution.getStore();
  if (!execution) return;
  const [row] = await getSql()`select payload from outbox_actions where id=${execution.id} and state='running' and attempts=${execution.attempts}`;
  if (!row) throw new JobYield();
  if(execution.userId&&execution.kind){const [policy]=await getSql()`select coast_job_allowed(${execution.userId}::uuid,${execution.kind},${row.payload}::jsonb) as allowed`;if(!policy.allowed)throw new JobYield();}
  execution.purpose = readJobPurpose(row.payload, execution.purpose);
  updateJobRequestPriority(execution.id, purposePriority(execution.purpose));
  execution.checkpoints++;
  if (execution.checkpoints >= 5 || performance.now() - execution.started >= 10_000) throw new JobYield();
}

/** Persist task-owned cursors without overwriting concurrently promoted intent. */
export async function saveJobCheckpoint(data: Record<string, unknown>, store?: Pick<Database,'execute'>) {
  const execution = jobExecution.getStore();
  if (!execution) return;
  if (store) {
    await store.execute(sql`update outbox_actions set payload=jsonb_set(payload,'{_checkpoint}',${data}::jsonb,true),updated_at=now()
      where id=${execution.id} and state='running' and attempts=${execution.attempts}`);
    return;
  }
  await getSql()`update outbox_actions set payload=jsonb_set(payload,'{_checkpoint}',${data}::jsonb,true),updated_at=now()
    where id=${execution.id} and state='running' and attempts=${execution.attempts}`;
}

export async function readJobCheckpoint(): Promise<Record<string, unknown> | null> {
  const execution = jobExecution.getStore();
  if (!execution) return null;
  const [row] = await getSql()`select payload->'_checkpoint' as checkpoint from outbox_actions
    where id=${execution.id} and state='running' and attempts=${execution.attempts}`;
  return row?.checkpoint ?? null;
}

/** A queued request rechecks policy after waiting for its provider lane. */
export async function assertJobFeaturePolicy() {
  const execution=jobExecution.getStore();if(!execution?.userId||!execution.kind)return;
  const [policy]=await getSql()`select coast_job_allowed(${execution.userId}::uuid,${execution.kind},${execution.payload??{}}::jsonb) as allowed`;
  if(!policy.allowed)throw new JobYield();
}
