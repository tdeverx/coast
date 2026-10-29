
import { AppError } from '#lib/server/security/errors.js';
import { listActions, cancelAction, retryAction, promoteAction, listTaskActions, updateTaskActions } from '#lib/server/queue/index.js';
import { uuid, type ApiContext } from './context.server';
import { readTaskCommand,resumeTaskCommand,abandonTaskCommand,listTaskCommands } from '#lib/server/queue/task-commands.server.js';
import type { TaskControlSpec } from '#lib/providers/task-control.js';

export async function handleQueue(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'queue') {
      if(path[1]==='tasks'&&path.length===2&&method==='GET')result=await listTaskActions(user);
      else if(path[1]==='tasks'&&path.length===3&&method==='POST'&&['retry','cancel','promote'].includes(path[2])){
        const kind=typeof body.kind==='string'&&/^[a-z0-9][a-z0-9._-]{1,79}$/.test(body.kind)?body.kind:null;
        if(!kind)throw new AppError(400,'Invalid task kind.');
        result=await updateTaskActions(user,kind,body.instanceId==null?null:uuid(body.instanceId),path[2] as 'retry'|'cancel'|'promote',uuid(body.commandId));
      }
      else if(path[1]==='task-commands'&&path.length===2&&method==='GET')result=await listTaskCommands(user);
      else if(path[1]==='task-commands'&&path.length===3&&method==='GET')result=await readTaskCommand(user,uuid(path[2]));
      else if(path[1]==='task-commands'&&path.length===4&&method==='POST'&&path[3]==='resume')result=await resumeTaskCommand(user,uuid(path[2]),body.revision as number,context.request.signal);
      else if(path[1]==='task-commands'&&path.length===4&&method==='POST'&&path[3]==='abandon')result=await abandonTaskCommand(user,uuid(path[2]),body as TaskControlSpec);
      else if (path.length === 1 && method === 'GET') result = await listActions(user);
      else if (path[2] === 'cancel' && method === 'POST')
        result = await cancelAction(user, uuid(path[1]));
      else if (path[2] === 'retry' && method === 'POST')
        result = await retryAction(user, uuid(path[1]));
      else if (path[2] === 'promote' && method === 'POST')
        result = await promoteAction(user, uuid(path[1]));
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return Response.json(result ?? { ok: true });
}
