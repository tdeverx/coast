import * as games from '#lib/core/games/service.server.js';

import { AppError } from '#lib/server/security/errors.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { uuid, type ApiContext } from './context.server';

export async function handleGamePlaythroughs(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, url, body, request } = context;
 let result: unknown;
 if (path[0] === 'game-playthroughs') {
      if (path.length === 2 && method === 'GET')
        result = await withReadCancellation(request.signal,()=>games.playthroughDetails(uid, uuid(path[1]), Number(url.searchParams.get('page') ?? 1)));
      else if (path.length === 2 && method === 'PATCH') result = await games.updatePlaythrough(uid, uuid(path[1]), body);
      else if (path.length === 3 && path[2] === 'sessions' && method === 'POST')
        result = await games.logGameSession(uid, uuid(path[1]), body);
      else if(path.length===4&&path[2]==='sessions'&&method==='DELETE')
        result = await games.removeGameSession(uid,uuid(path[1]),uuid(path[3]));
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return Response.json(result ?? { ok: true });
}
