import { AppError } from '#lib/server/security/errors.js';
import { error, isHttpError } from '@sveltejs/kit';
import { titleInsights } from '#lib/catalogue/details.server.js';
export const GET = async ({ locals, params, url }) => {
  if(!locals.user)error(401,'Sign in to view insights.');
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) error(400, 'Invalid title.');
  const source = url.searchParams.get('source') ?? 'tmdb';
  if (!['tmdb', 'trakt'].includes(source)) error(400, 'Invalid rating source.');
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) error(400, 'Invalid page.');
  try {
    return Response.json(await titleInsights(locals.user!.id, params.id, source, page));
  } catch(cause) {
    if(cause instanceof AppError)return Response.json({error:cause.message,code:cause.code},{status:cause.status});
    if(isHttpError(cause))return Response.json({error:cause.body.message,code:'request_failed'},{status:cause.status});
    return Response.json(
      { error: `${source === 'tmdb' ? 'TMDB' : 'Trakt'} details are temporarily unavailable.` },
      { status: 503 }
    );
  }
};
