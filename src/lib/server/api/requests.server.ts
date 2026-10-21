
import * as v from 'valibot';
import { AppError } from '#lib/server/security/errors.js';
import { requestOptions, requestMedia, manageRequest } from '#lib/providers/seerr/requests.server.js';
import { uuid, type ApiContext } from './context.server';
import {requestFeedSchema,requestFeedCard} from '#lib/library-feed.js';
import {requestList} from '#lib/server/queries/requests.js';
import {requireFeature} from '#lib/server/features.js';
import {PAGE_SIZE} from '#lib/server/queries/pagination.js';
import {ROW_BATCH_SIZE} from '#lib/page-window.js';

export async function handleRequests(context: ApiContext): Promise<Response | undefined> {
 const { uid, path, method, url, body } = context;
 let result: unknown;
 if (path[0] === 'requests') {
      if(path.length===1&&method==='GET'){
        await requireFeature(uid,'requests');await requireFeature(uid,'screen');
        const options=v.parse(requestFeedSchema,{state:url.searchParams.get('state')??undefined,kind:url.searchParams.get('kind')??undefined,page:url.searchParams.has('page')?Number(url.searchParams.get('page')):undefined,preview:url.searchParams.get('preview')==='true'});
        const admin=context.user.role==='admin';
        const data=await requestList(uid,options.page,undefined,{...options,pageSize:options.preview?ROW_BATCH_SIZE:PAGE_SIZE,allUsers:admin},context.request.signal);
        context.request.signal.throwIfAborted();
        result={page:data.page,pages:data.pages,total:data.total,items:data.requests.flatMap(request=>request.item?[requestFeedCard(request.item,request,admin?request.requester:undefined)]:[])};
      }else if (path[1] === 'options' && method === 'GET') {
        const options = await requestOptions(uid, uuid(url.searchParams.get('mediaId')), context.request.signal);
        result = {
          destinations: options.map((d) => ({
            id: d.instanceId,
            name: d.name,
            variants: d.variants,
          })),
        };
      } else if (path.length === 1 && method === 'POST')
        result = await requestMedia(uid, {
          ...body,
          addToWatchlist: body.watchlist !== false,
        });
      else if (path.length === 2 && method === 'POST')
        result = await manageRequest(
          uid,
          uuid(path[1]),
          v.parse(v.picklist(['cancel', 'approve', 'decline']), body.action)
        );
      else throw new AppError(404, 'Action not found.');
    } else return undefined;
 return Response.json(result ?? { ok: true });
}
