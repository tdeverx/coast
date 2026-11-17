import { downloadSubtitle, searchSubtitles, subtitleOptions } from '#lib/playback/subtitles.server.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { AppError } from '#lib/server/security/errors.js';
import { uuid, type ApiContext } from './context.server';

export async function handleSubtitles({ user, path, method, body, url, request }: ApiContext, session: boolean) {
  const target = { id: uuid(path[1]), session };
  const headers = { 'Cache-Control': 'private, no-store' };
  if (method === 'GET') return Response.json(await withReadCancellation(request.signal,
    () => subtitleOptions(user, target, url.searchParams, request.signal)), { headers });
  if (method === 'POST') return Response.json(body && typeof body === 'object' && 'language' in body
    ? await withReadCancellation(request.signal, () => searchSubtitles(user, target, body, request.signal))
    : await downloadSubtitle(user, target, body), { headers });
  throw new AppError(405, 'This subtitle action is unavailable.');
}
