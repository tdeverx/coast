import { AsyncLocalStorage } from 'node:async_hooks';
import { getSql, type Database } from '../db';
import { outboxActions } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { purposePriority, readJobPurpose, type JobPurpose } from '$lib/providers/job-policy';
import { updateJobRequestPriority } from '../security/request-priority';

type Execution = { id: string; attempts: number; purpose: JobPurpose; started: number; checkpoints: number };
export const jobExecution = new AsyncLocalStorage<Execution>();
/** Control flow, never a provider failure or a retry attempt. */
export class JobYield extends Error {
  constructor() { super('Job yielded at a committed checkpoint.'); this.name = 'JobYield'; }
}

/** Fence personal writes in their committing transaction, after locking the
 * connection so reconnect/reset retains the same lock order. */
export async function assertJobLease(store:Pick<Database,'select'>, lock=false) {
  const execution=jobExecution.getStore();
  if(!execution)return;
  const query=store.select({id:outboxActions.id}).from(outboxActions).where(and(
    eq(outboxActions.id,execution.id),eq(outboxActions.state,'running'),eq(outboxActions.attempts,execution.attempts)));
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
  execution.purpose = readJobPurpose(row.payload, execution.purpose);
  updateJobRequestPriority(execution.id, purposePriority(execution.purpose));
  execution.checkpoints++;
  if (execution.checkpoints >= 5 || performance.now() - execution.started >= 10_000) throw new JobYield();
}

/** Persist task-owned cursors without overwriting concurrently promoted intent. */
export async function saveJobCheckpoint(data: Record<string, unknown>) {
  const execution = jobExecution.getStore();
  if (!execution) return;
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
