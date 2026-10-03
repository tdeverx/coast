import { readJsonBody } from '$lib/server/security/request-body';
import { json, type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import { claimShare, shareCookie, sharedState, startShared, sharedProgress, sharedStream, shareViewer } from '$lib/sharing/service.server';
import { AppError } from '$lib/server/security/errors';
import { getSql } from '$lib/server/db';

const headers = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const handler: RequestHandler = async ({ request, params, cookies, locals, url }) => {
 try {
  const path = (params.path ?? '').split('/'), token = cookies.get(shareCookie);
  if (request.method === 'POST' && path.length === 1 && path[0] === 'claim') {
   const grant = await claimShare(await readJsonBody(request,65536,false), locals.user, token);
   cookies.set(shareCookie, grant.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', expires: new Date(grant.expiresAt) });
   return json({ ok: true }, { headers });
  }
  if (request.method === 'GET' && path.join('/') === 'state') return json(await sharedState(token), { headers });
  if (path[0] === 'playback') {
   if (request.method === 'POST' && path.length === 1) return json(await startShared(token, await readJsonBody(request,65536,false)), { headers });
   if (request.method === 'GET' && path.length === 3 && path[2] === 'stream') return sharedStream(token, path[1], request);
   if (request.method === 'POST' && path.length === 3 && path[2] === 'progress') return json(await sharedProgress(token, path[1], await readJsonBody(request,65536,false)), { headers });
   if (request.method === 'POST' && path.length === 3 && path[2] === 'error') {
    const viewer = await shareViewer(token);
    if (viewer.playback_id !== path[1]) throw new AppError(403, 'This session belongs to another viewer.');
    await getSql()`update playback_sessions set state='stopped',updated_at=now() where id=${viewer.playback_id}`;
    return json({ ok: true }, { headers });
   }
  }
  throw new AppError(404, 'Endpoint not found.');
 } catch (error) {
  const status = error instanceof AppError ? error.status : v.isValiError(error) ? 400 : 503;
  return json({ error: error instanceof AppError ? error.message : status === 400 ? 'Check the supplied fields.' : 'Playback is currently unavailable.' }, { status, headers });
 }
};
export const GET = handler;
export const POST = handler;
