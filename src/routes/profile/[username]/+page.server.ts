import { mediaRows } from '$lib/server/queries/media-rows';
import type { PageServerLoad } from './$types';
import * as v from 'valibot';
import { profileUser } from '$lib/server/queries/profile-user';
import { profilePath } from '$lib/profile/url';
import { AppError } from '$lib/server/security/errors';
import { error, redirect } from '@sveltejs/kit';
import { profileData, profileActivity, profileOptionsSchema } from '$lib/server/queries/profile';
export const load = (async ({locals, url, params, depends}) => {
  depends('coast:tracking');

  const viewer = locals.user;
  let user;
  try {
    user = await profileUser(params.username);
  } catch (cause) {
    if (cause instanceof AppError) error(cause.status, cause.message);
    throw cause;
  }
  if (params.username !== user.username) redirect(307, profilePath(user.username) + url.search);
  const parsed = v.safeParse(profileOptionsSchema, {
    scope: url.searchParams.get('scope') ?? 'all',
    view: url.searchParams.get('view') ?? 'overview',
    kind: url.searchParams.get('kind') ?? user.settings.profile?.favouriteKind ?? 'all',
    period: url.searchParams.get('period') ?? user.settings.profile?.period ?? 'all',
    query: url.searchParams.get('q') ?? '',
    activityKind: url.searchParams.get('type') ?? 'all',
    repeats: url.searchParams.get('repeats') === 'true',
    rating: url.searchParams.has('rating') ? Number(url.searchParams.get('rating')) : undefined,
    genre: url.searchParams.get('genre') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
  });
  if (!parsed.success) error(400, 'Choose a valid profile view and page.');
  if (parsed.output.from && parsed.output.to && parsed.output.from > parsed.output.to)
    error(400, 'The start date must be before the end date.');
  const { view } = parsed.output;
  const details=await profileData(user.id, parsed.output, new Date(), viewer?.id??null).catch(cause=>{if(cause instanceof AppError)error(cause.status,cause.message);throw cause;});
  const activity =
    view === 'overview' && details.visibility.insights
      ? profileActivity(user.id, new Date(), parsed.output.period,viewer?.id??null).catch(() => null)
      : Promise.resolve(null);
  return {
    ...details,
    username: user.username,
    isOwner: user.id === viewer?.id,
    activity,
    mediaRows: view === 'overview' && user.id === viewer?.id ? await mediaRows(true) : null,
  };
}) satisfies PageServerLoad;
