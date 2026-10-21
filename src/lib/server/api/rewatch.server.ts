import { wholeWorkId } from '#lib/core/tracking/continue.server.js';
import { setRewatch } from '#lib/core/tracking/rewatch.server.js';

import { getDb } from '#lib/server/db/index.js';
import { uuid, type ApiContext } from './context.server';

export async function handleRewatch(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'rewatch' && path.length === 1 && method === 'POST') result = await setRewatch(uid, {
        ...body,
        mediaId: await wholeWorkId(getDb(), uuid(body.mediaId)),
      }); else return undefined;
 return Response.json(result ?? { ok: true });
}
