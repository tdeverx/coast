import { profileUser } from '$lib/server/queries/profile-user';
import { AppError } from '$lib/server/security/errors';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { progressOptionsSchema, progressParameters, progressSurface } from '$lib/progress';
import { progressData } from '$lib/server/queries/progress';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url, depends }) => {
  depends('coast:tracking');
  if (!locals.user) error(401, 'Sign in to view your progress.');
  const options = v.safeParse(progressOptionsSchema, progressParameters(url));
  if (!options.success) error(400, 'Choose a valid progress view and filters.');
  let subject;
  try {
    subject = url.searchParams.has('username')
      ? await profileUser(url.searchParams.get('username')!)
      : locals.user;
  } catch (cause) {
    if (cause instanceof AppError) error(cause.status, cause.message);
    throw cause;
  }
  return {
    profileContext: url.searchParams.has('username'),
    surface: progressSurface(options.output.view, url.searchParams.has('username')),
    progress: await progressData(subject.id, options.output, locals.user.id),
    username: subject.username,
    isOwner: subject.id === locals.user.id,
  };
};
