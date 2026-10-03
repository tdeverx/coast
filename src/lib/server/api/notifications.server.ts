import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { AppError } from '$lib/server/security/errors';
import { broadcast } from '$lib/server/notifications';
import { notificationInbox,notificationParameters,markNotification,markNotificationsRead,markNotificationsSeen } from '$lib/server/notifications/inbox';
import { uuid, type ApiContext } from './context.server';

export async function handleNotifications(context: ApiContext): Promise<Response | undefined> {
 const { user, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'notifications') {
      if (path.length === 1 && method === 'GET') result = await notificationInbox(user,notificationParameters(url));
      else if(path[1]==='seen'&&method==='POST')result=await markNotificationsSeen(user,body);
      else if(path[1]==='read-all'&&method==='POST')result=await markNotificationsRead(user,body);
      else if (path[1] === 'broadcast' && method === 'POST') result = await broadcast(user, body);
      else if (path.length===2 && method === 'POST')
        result = await markNotification(
          user,
          uuid(path[1]),
          v.parse(v.picklist(['read', 'dismiss']), body.action)
        );
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return json(result ?? { ok: true });
}
