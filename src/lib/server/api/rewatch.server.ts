import { wholeWorkId } from '$lib/core/tracking/continue';
import { setRewatch } from '$lib/core/tracking/rewatch';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { uuid, type ApiContext } from './context.server';

export async function handleRewatch(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'rewatch' && path.length === 1 && method === 'POST') result = await setRewatch(uid, {
        ...body,
        mediaId: await wholeWorkId(getDb(), uuid(body.mediaId)),
      }); else return undefined;
 return json(result ?? { ok: true });
}
