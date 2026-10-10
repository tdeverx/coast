import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { trackingInputSchema, bulkTrackingInputSchema } from '$lib/core/tracking/service.server';
import { trackWithExports, bulkTrackWithExports } from '$lib/sync/changes.server';
import { uuid, type ApiContext } from './context.server';

export async function handleTracking(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, body } = context;
 let result: unknown;
 if (path[0] === 'tracking' && method === 'POST') {
      const clean = {
        ...body,
        mediaId: uuid(body.mediaId),
        source: 'coast',
        sourceEventId: undefined,
      };
      result =
        path[1] === 'bulk'
          ? await bulkTrackWithExports(uid, v.parse(bulkTrackingInputSchema, clean))
          : await trackWithExports(uid, v.parse(trackingInputSchema, clean));
    } else return undefined;
 return json(result ?? { ok: true });
}
