import type { SQL } from 'bun';
import * as v from 'valibot';
import { getSql } from '../db';
import { requireAdmin, type SessionUser } from '../auth';
import { AppError } from '../security/errors';
import { purposePriority, readJobPurpose, taskControlLimit } from '#lib/providers/job-policy.js';
import type { TaskControlAction, TaskControlCommand, TaskControlSpec, TaskControlListing } from '#lib/providers/task-control.js';
import { updateJobRequestPriority } from '../security/request-priority';
import { cancelAction, retryAction, promoteAction, selectTaskTargets } from './task-controls.server';

type CommandRecord = {id:string;actor_id:string;kind:string;instance_id:string|null;action:TaskControlAction;status:TaskControlCommand['status'];target_ids:string[]|null;outcomes:('updated'|'skipped')[]|null;total:number;updated:number;skipped:number;revision:number;has_more:boolean;blocked:boolean;last_error:string|null;compacted_at:Date|null};
const input=v.strictObject({kind:v.pipe(v.string(),v.regex(/^[a-z0-9][a-z0-9._-]{1,79}$/)),instanceId:v.nullable(v.pipe(v.string(),v.uuid())),action:v.picklist(['retry','cancel','promote'])});
const uuid=v.pipe(v.string(),v.uuid());
function receipt(row:CommandRecord):TaskControlCommand {
  return {id:row.id,kind:row.kind,instanceId:row.instance_id,action:row.action,status:row.status,revision:row.revision,updated:row.updated,skipped:row.skipped,total:row.total,remaining:row.total-row.updated-row.skipped,hasMore:row.has_more,blocked:row.blocked,error:row.last_error,compacted:!!row.compacted_at};
}
async function authorize(sql:SQL,actor:SessionUser|null) {
  const user=requireAdmin(actor);
  const [current]=await sql`select id from users where id=${user.id} and role='admin' and disabled=false`;
  if(!current)throw new AppError(403,'Administrator access is required.');
  return user;
}
async function owned(sql:SQL,actorId:string,id:string,lock=false) {
  const rows=await sql<CommandRecord[]>`select * from task_control_commands where id=${id} and actor_id=${actorId} ${sql.unsafe(lock?'for update':'')}`;
  if(!rows[0])throw new AppError(404,'Task action not found.');
  return rows[0];
}
function same(row:CommandRecord,spec:TaskControlSpec) {
  if(row.kind!==spec.kind||row.instance_id!==spec.instanceId||row.action!==spec.action)
    throw new AppError(409,'This command identity belongs to a different task action.','task_command_conflict');
}
/** Admission is bounded and has no queue effects. The supplied identity is fixed
 * before the first request; replay never selects a second batch. */
export async function updateTaskActions(actor:SessionUser|null,kind:string,instanceId:string|null,action:TaskControlAction,id:string) {
  const spec=v.parse(input,{kind,instanceId,action});v.parse(uuid,id);requireAdmin(actor);
  return getSql().begin(async sql=>{
    const user=await authorize(sql,actor);
    await sql`select pg_advisory_xact_lock(hashtextextended(${`task-command:${id}`},0))`;
    const [previous]=await sql<CommandRecord[]>`select * from task_control_commands where id=${id}`;
    if(previous){if(previous.actor_id!==user.id)throw new AppError(404,'Task action not found.');same(previous,spec);return receipt(previous);}
    const selected=await selectTaskTargets(sql,kind,instanceId,action);
    const [row]=await sql<CommandRecord[]>`insert into task_control_commands(id,actor_id,kind,instance_id,action,status,target_ids,outcomes,total,has_more,blocked)
      values(${id},${user.id},${kind},${instanceId},${action},${selected.ids.length?'incomplete':'complete'},${sql.array(selected.ids,'UUID')},'[]'::jsonb,${selected.ids.length},${selected.hasMore},${selected.blocked}) returning *`;
    return receipt(row);
  });
}
async function restorePriority(row:CommandRecord) {
  if(row.action!=='promote'||!row.target_ids||!row.outcomes)return;
  const ids=row.target_ids.filter((_,i)=>row.outcomes?.[i]==='updated');if(!ids.length)return;
  const sql=getSql();const jobs=await sql<{id:string;payload:Record<string,unknown>}[]>`select id,payload from outbox_actions where id=any(${sql.array(ids,'UUID')}) and state in ('pending','running')`;
  for(const job of jobs)updateJobRequestPriority(job.id,purposePriority(readJobPurpose(job.payload,'scheduled')));
}
export async function readTaskCommand(actor:SessionUser|null,id:string) {
  v.parse(uuid,id);
  return getSql().begin(async sql=>{const user=await authorize(sql,actor);return receipt(await owned(sql,user.id,id));});
}
/** A revision is a consumed acknowledgement, not a time lease. Stale duplicate
 * requests return current receipts without advancing another target. Each target
 * commits its native effect and receipt together; errors stop without a cursor. */
export async function resumeTaskCommand(actor:SessionUser|null,id:string,revision:number,signal?:AbortSignal) {
  v.parse(uuid,id);v.parse(v.pipe(v.number(),v.integer(),v.minValue(0)),revision);requireAdmin(actor);
  let latest:CommandRecord|undefined;
  for(let count=0;count<taskControlLimit;count++){
    if(signal?.aborted)break;
    const step=await getSql().begin(async sql=>{
      const user=await authorize(sql,actor),row=await owned(sql,user.id,id,true);
      if(row.status!=='incomplete'||row.revision!==revision)return {row,advanced:false};
      const ordinal=row.updated+row.skipped,target=row.target_ids?.[ordinal];
      if(!target)throw new Error('Task command target membership is missing.');
      let outcome:'updated'|'skipped'='updated',error:string|null=null;
      try{
        await sql.savepoint(async tx=>{
          if(row.action==='cancel')await cancelAction(user,target,tx);
          else if(row.action==='retry')await retryAction(user,target,tx);
          else await promoteAction(user,target,tx);
        });
      }catch(cause){
        if(cause instanceof AppError&&cause.status===409)outcome='skipped';
        else error=cause instanceof AppError?cause.message.slice(0,500):'This task action was interrupted. Resume to retry the remaining jobs.';
      }
      const updated=row.updated+(!error&&outcome==='updated'?1:0),skipped=row.skipped+(!error&&outcome==='skipped'?1:0);
      const [next]=await sql<CommandRecord[]>`update task_control_commands set updated=${updated},skipped=${skipped},revision=revision+1,
        outcomes=${error?row.outcomes:[...row.outcomes!,outcome]}::jsonb,status=${updated+skipped===row.total?'complete':'incomplete'},last_error=${error},updated_at=now() where id=${id} returning *`;
      return {row:next,advanced:true};
    });
    latest=step.row;
    if(!step.advanced||latest.last_error||latest.status!=='incomplete')break;
    revision=latest.revision;
  }
  if(!latest)return readTaskCommand(actor,id);
  await restorePriority(latest);
  return receipt(latest);
}
/** Missing admission can also be abandoned: a terminal tombstone prevents a
 * delayed first request from creating new work after the user abandoned it. */
export async function abandonTaskCommand(actor:SessionUser|null,id:string,spec:TaskControlSpec) {
  v.parse(uuid,id);v.parse(input,spec);requireAdmin(actor);
  return getSql().begin(async sql=>{
    const user=await authorize(sql,actor);
    await sql`select pg_advisory_xact_lock(hashtextextended(${`task-command:${id}`},0))`;
    const [previous]=await sql<CommandRecord[]>`select * from task_control_commands where id=${id} for update`;
    if(previous){
      if(previous.actor_id!==user.id)throw new AppError(404,'Task action not found.');same(previous,spec);
      if(previous.status!=='incomplete')return receipt(previous);
      const [next]=await sql<CommandRecord[]>`update task_control_commands set status='abandoned',last_error=null,revision=revision+1,updated_at=now() where id=${id} returning *`;
      return receipt(next);
    }
    const [row]=await sql<CommandRecord[]>`insert into task_control_commands(id,actor_id,kind,instance_id,action,status,target_ids,outcomes,total)
      values(${id},${user.id},${spec.kind},${spec.instanceId},${spec.action},'abandoned','{}'::uuid[],'[]'::jsonb,0) returning *`;
    return receipt(row);
  });
}
/** No history walk or per-row client query. Unfinished records win admission;
 * completing/abandoning the displayed batch exposes the next bounded page. */
export async function listTaskCommands(actor:SessionUser|null):Promise<TaskControlListing> {
  return getSql().begin(async sql=>{
    const user=await authorize(sql,actor);
    const unfinished=await sql<CommandRecord[]>`select * from task_control_commands where actor_id=${user.id} and status='incomplete' order by created_at,id limit 101`;
    const recent=await sql<CommandRecord[]>`select * from task_control_commands where actor_id=${user.id} and status<>'incomplete' order by created_at desc,id desc limit 20`;
    return {items:[...unfinished.slice(0,100),...recent].map(receipt),more:unfinished.length>100};
  });
}
