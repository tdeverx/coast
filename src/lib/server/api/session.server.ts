import { heartbeat, setStatus, setPresenceSharing } from '$lib/social/status.server';
import { json } from '@sveltejs/kit';
import { type ApiContext } from './context.server';

export async function handleSession(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, locals } = context;
 if(path.length===2&&path[0]==='session'&&method==='POST'){
  if(path[1]==='heartbeat')return json(await heartbeat(user.id,context.body));
  if(path[1]==='presence')return json(await setPresenceSharing(user.id,context.body));
  if(path[1]==='status')return json(await setStatus(user.id,context.body));
 }
 let result: unknown;
 if (path[0] === 'session' && method === 'GET') result = { user, expiresAt: locals.expiresAt }; else return undefined;
 return json(result ?? { ok: true });
}
