import { changeContinue } from '#lib/core/tracking/continue.server.js';

import { type ApiContext } from './context.server';

export async function handleContinue(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'continue' && path.length === 1 && method === 'POST') result = await changeContinue(uid, body); else return undefined;
 return Response.json(result ?? { ok: true });
}
