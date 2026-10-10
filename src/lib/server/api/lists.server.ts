import { logDiagnostic } from '$lib/server/diagnostics';
import { restartPlaylist } from '$lib/core/lists/sequence.server';
import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AppError } from '$lib/server/security/errors';
import * as lists from '$lib/core/lists/service.server';
import { userLists } from '$lib/server/queries/lists';
import { queueTraktListChange, deleteListWithExports } from '$lib/sync/trakt-lists.server';
import { uuid, type ApiContext } from './context.server';

export async function handleLists(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'lists') {
      if (path.length === 1 && method === 'GET') result = { lists: await userLists(uid) };
      else if (path[1] === 'summaries' && path.length === 2 && method === 'GET')
        result = { lists: await lists.getLists(uid) };
      else if (path.length === 1 && method === 'POST')
        result = await lists.createList(uid, body as Parameters<typeof lists.createList>[1]);
      else if (path.length === 2 && method === 'PATCH')
        result = await lists.updateList(
          uid,
          uuid(path[1]),
          body as Parameters<typeof lists.updateList>[2]
        );
      else if (path.length === 2 && method === 'DELETE')
        result = await deleteListWithExports(uid, uuid(path[1]));
      else if (path[2] === 'playback' && method === 'POST') {
        const list = await lists.getList(uid, uuid(path[1]));
        if (!list.playbackStartedAt || body.restart === true) await restartPlaylist(uid, list.id);
        result = { ok: true };
      } else if (path[2] === 'items' && method === 'POST')
        result = await lists.addListItem(
          uid,
          uuid(path[1]),
          uuid(body.mediaId),
          body.restorePosition as number | undefined
        );
      else if (path[2] === 'items' && method === 'DELETE')
        result = await lists.removeListItem(uid, uuid(path[1]), uuid(body.entryId));
      else if (path[2] === 'order' && method === 'POST')
        result = await lists.reorderList(
          uid,
          uuid(path[1]),
          v.parse(v.array(v.pipe(v.string(), v.uuid())), body.ids)
        );
      else if (path[2] === 'move' && method === 'POST')
        result = await lists.moveListItem(uid, uuid(path[1]), body);
      else throw new AppError(404, 'Action not found.');
      if (method !== 'GET' && !(path.length === 2 && method === 'DELETE')) {
        const listId = path.length === 1 ? (result as { id?: string })?.id : path[1];
        if (listId)
          await queueTraktListChange(uid, listId).catch(async () => {
            void logDiagnostic('error', 'job.failed', { failure: 'unexpected' });
          });
      }
    } else return undefined;
 return json(result ?? { ok: true });
}
