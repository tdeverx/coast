import { readJsonBody } from '#lib/server/security/request-body.js';
import { type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { claimShare, shareCookie, sharedState, startShared, sharedProgress, sharedStream, shareViewer } from '#lib/sharing/service.server.js';
import { AppError } from '#lib/server/security/errors.js';
import { releaseViewer } from '#lib/sharing/leases.server.js';
import {externalStream} from '#lib/sharing/external.server.js';
import {startSharedReading,sharedReadingResource,touchSharedReading,closeSharedReading} from '#lib/sharing/reading.server.js';

const headers = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const handler: RequestHandler = async ({ request, params, cookies, locals, url }) => {
 try {
  const path = (params.path ?? '').split('/'), token = cookies.get(shareCookie);
  if(['GET','HEAD'].includes(request.method)&&path[0]==='external'&&path.length===3&&['stream','stream.m3u8'].includes(path[2]))return await externalStream(path[1],request);
  if (request.method === 'POST' && path.length === 1 && path[0] === 'claim') {
   const grant = await claimShare(await readJsonBody(request,65536,false), locals.user, token);
   cookies.set(shareCookie, grant.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', expires: new Date(grant.expiresAt) });
   return Response.json({ ok: true }, { headers });
  }
  if (request.method === 'GET' && path.join('/') === 'state') return Response.json(await sharedState(token), { headers });
  if(path[0]==='reading'){
   if(request.method==='POST'&&path.length===1)return Response.json(await startSharedReading(token,await readJsonBody(request,65536,false),request.signal),{headers});
   if(request.method==='POST'&&path.length===3&&['heartbeat','close'].includes(path[2])){
    v.parse(v.strictObject({}),await readJsonBody(request,65536,false));
    return Response.json(path[2]==='close'?await closeSharedReading(token,path[1]):await touchSharedReading(token,path[1],request.signal),{headers});
   }
   if(path.length===3&&(path[2]==='file'&&['GET','HEAD'].includes(request.method)||path[2]==='manifest'&&request.method==='GET'))
    return await sharedReadingResource(token,path[1],path[2],request);
   if(path.length===4&&path[2]==='pages'&&request.method==='GET')return await sharedReadingResource(token,path[1],'pages',request,path[3]);
  }
  if (path[0] === 'playback') {
   if (request.method === 'POST' && path.length === 1) return Response.json(await startShared(token, await readJsonBody(request,65536,false),request.signal), { headers });
   if (['GET','HEAD'].includes(request.method) && path.length === 3 && path[2] === 'stream') return await sharedStream(token, path[1], request);
   if (request.method === 'POST' && path.length === 3 && path[2] === 'progress') return Response.json(await sharedProgress(token, path[1], await readJsonBody(request,65536,false)), { headers });
   if (request.method === 'POST' && path.length === 3 && path[2] === 'error') {
    const viewer = await shareViewer(token);
    if (viewer.playback_id !== path[1]) throw new AppError(403, 'This session belongs to another viewer.');
    await releaseViewer(viewer.owner_id,viewer.viewer_id);
    return Response.json({ ok: true }, { headers });
   }
  }
  throw new AppError(404, 'Endpoint not found.');
 } catch (error) {
  const status = error instanceof AppError ? error.status : v.isValiError(error) ? 400 : 503;
  return Response.json({ error: error instanceof AppError ? error.message : status === 400 ? 'Check the supplied fields.' : 'Playback is currently unavailable.' }, { status, headers });
 }
};
export const GET = handler;
export const POST = handler;
export const HEAD = handler;
