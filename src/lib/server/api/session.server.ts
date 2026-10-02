import { json } from '@sveltejs/kit';
import { type ApiContext } from './context.server';

export async function handleSession(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, locals } = context;
 let result: unknown;
 if (path[0] === 'session' && method === 'GET') result = { user, expiresAt: locals.expiresAt }; else return undefined;
 return json(result ?? { ok: true });
}
