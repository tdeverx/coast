
import { AppError } from '#lib/server/security/errors.js';
import { startPlayback, progressPlayback, recordPlaybackError } from '#lib/playback/service.server.js';
import { uuid, type ApiContext } from './context.server';

export async function handlePlayback(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'playback') {
      if (path.length === 1 && method === 'POST') result = await startPlayback(uid, body, undefined, context.request.signal);
      else if (path[2] === 'progress' && method === 'POST')
        result = await progressPlayback(uid, uuid(path[1]), body);
      else if (path[2] === 'error' && method === 'POST')
        result = await recordPlaybackError(uid, uuid(path[1]), body.code);
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return Response.json(result ?? { ok: true });
}
