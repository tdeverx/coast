import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AppError } from '$lib/server/security/errors';
import { requestOptions, requestMedia, manageRequest } from '$lib/providers/seerr/requests.server';
import { uuid, type ApiContext } from './context.server';

export async function handleRequests(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'requests') {
      if (path[1] === 'options' && method === 'GET') {
        const options = await requestOptions(uid, uuid(url.searchParams.get('mediaId')));
        result = {
          destinations: options.map((d) => ({
            id: d.instanceId,
            name: d.name,
            variants: d.variants,
          })),
        };
      } else if (path.length === 1 && method === 'POST')
        result = await requestMedia(uid, {
          ...body,
          addToWatchlist: body.watchlist !== false,
        });
      else if (path.length === 2 && method === 'POST')
        result = await manageRequest(
          uid,
          uuid(path[1]),
          v.parse(v.picklist(['cancel', 'approve', 'decline']), body.action)
        );
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
