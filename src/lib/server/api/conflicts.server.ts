import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AppError } from '$lib/server/security/errors';
import { getPendingConflicts, resolveConflict } from '$lib/sync/conflicts.server';
import { uuid, type ApiContext } from './context.server';

export async function handleConflicts(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'conflicts') {
      if (path.length === 1 && method === 'GET') result = await getPendingConflicts(uid);
      else if (path.length === 2 && method === 'POST')
        result = await resolveConflict(
          uid,
          uuid(path[1]),
          v.parse(v.picklist(['accepted', 'ignored']), body.decision)
        );
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
