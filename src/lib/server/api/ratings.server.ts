import { json } from '@sveltejs/kit';
import { rateWithExports } from '$lib/sync/changes';
import { type ApiContext } from './context.server';

export async function handleRatings(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'ratings' && method === 'POST') result = await rateWithExports(uid, body as Parameters<typeof rateWithExports>[1]); else return undefined;
 return json(result ?? { ok: true });
}
