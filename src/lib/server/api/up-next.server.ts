import { setUpNext } from '$lib/core/lists/up-next';
import { json } from '@sveltejs/kit';
import { type ApiContext } from './context.server';

export async function handleUpNext(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'up-next' && path.length === 1 && method === 'POST') {
      await setUpNext(uid, body);
      result = { ok: true };
    } else return undefined;
 return json(result ?? { ok: true });
}
