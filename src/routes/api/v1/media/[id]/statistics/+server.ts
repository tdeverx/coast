import { AppError } from '#lib/server/security/errors.js';
import { error } from '@sveltejs/kit';
import { mediaStatistics } from '#lib/server/queries/media-statistics.js';
import type { ProfilePeriod } from '#lib/profile/period.js';
export const GET = async ({ locals, params, url }) => {
  if (!locals.user) error(401, 'Sign in to view your activity.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id))
    error(400, 'Invalid title.');
  const period = url.searchParams.get('period') ?? 'all';
  if (!['month', 'year', 'all'].includes(period)) error(400, 'Invalid period.');
  try { return Response.json(await mediaStatistics(locals.user.id, params.id, period as ProfilePeriod), {
    headers: { 'Cache-Control': 'private, no-store' },
  }); } catch(cause) {
    if(cause instanceof AppError)return Response.json({error:cause.message,code:cause.code},{status:cause.status});
    throw cause;
  }
};
