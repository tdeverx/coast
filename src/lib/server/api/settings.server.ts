import { json } from '@sveltejs/kit';
import { updatePassword, updateUserSettings, resetUserSettings } from '$lib/server/auth';
import { updateConfig } from '$lib/application/configuration.server';
import { AppError } from '$lib/server/security/errors';
import {createApiToken,listApiTokens,revokeApiToken} from '$lib/server/public-api/tokens.server';
import { uuid,text, type ApiContext } from './context.server';

export async function handleSettings(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'settings') {
      if(path[1]==='tokens') {
        if(path.length===2&&method==='GET')result=await listApiTokens(user);
        else if(path.length===2&&method==='POST')result=await createApiToken(user,body);
        else if(path.length===3&&method==='DELETE'){await revokeApiToken(user,uuid(path[2]));result={revoked:true};}
        else throw new AppError(404,'Action not found.');
      }
      else if (path.length === 1 && method === 'POST') result = await updateUserSettings(user, body);
      else if (path[1] === 'reset' && method === 'POST') result = await resetUserSettings(user);
      else if (path[1] === 'password' && method === 'POST')
        result = await updatePassword(user, text(body.currentPassword), body.password);
      else if (path[1] === 'system' && method === 'POST') result = await updateConfig(user, body);
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
