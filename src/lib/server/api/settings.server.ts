import { json } from '@sveltejs/kit';
import { updatePassword, updateUserSettings, resetUserSettings } from '$lib/server/auth';
import { updateConfig } from '$lib/application/configuration.server';
import { AppError } from '$lib/server/security/errors';
import { text, type ApiContext } from './context.server';

export async function handleSettings(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'settings') {
      if (path.length === 1 && method === 'POST') result = await updateUserSettings(user, body);
      else if (path[1] === 'reset' && method === 'POST') result = await resetUserSettings(user);
      else if (path[1] === 'password' && method === 'POST')
        result = await updatePassword(user, text(body.currentPassword), body.password);
      else if (path[1] === 'system' && method === 'POST') result = await updateConfig(user, body);
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
