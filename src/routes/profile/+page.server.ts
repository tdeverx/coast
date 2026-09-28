import { redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { profilePath } from '$lib/profile/url';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals, url }) => {
  redirect(307, profilePath(requireUser(locals.user).username) + url.search);
};
