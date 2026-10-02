import { json } from '@sveltejs/kit';
import { AppError } from '$lib/server/security/errors';
import { listActions, cancelAction, retryAction } from '$lib/server/queue';
import { uuid, type ApiContext } from './context.server';

export async function handleQueue(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method } = context;
 let result: unknown;
 if (path[0] === 'queue') {
      if (path.length === 1 && method === 'GET') result = await listActions(user);
      else if (path[2] === 'cancel' && method === 'POST')
        result = await cancelAction(user, uuid(path[1]));
      else if (path[2] === 'retry' && method === 'POST')
        result = await retryAction(user, uuid(path[1]));
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
